/*
  Relógio + clima em e-paper
  Placa:   ESP32-S3-WROOM-1 N16R8 (16 MB flash, 8 MB PSRAM octal)
  Display: WeAct Studio 1.54" e-paper 200x200 (controlador SSD1681)

  Bibliotecas (Arduino IDE > Gerenciar bibliotecas):
    - GxEPD2          (Jean-Marc Zingg)
    - Adafruit GFX    (vem como dependência do GxEPD2)
    - ArduinoJson     (Benoit Blanchon, versão 7.x)

  Ferramentas > Placa: "ESP32S3 Dev Module"
    Flash Size: 16MB | PSRAM: "OPI PSRAM" | USB CDC On Boot: "Enabled"
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <time.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>

// ---------- Configuração ----------
const char* WIFI_SSID = "SUA_REDE";
const char* WIFI_PASS = "SUA_SENHA";

// Fuso horário POSIX. Brasília/SP/RJ/DF: "<-03>3"  |  Manaus: "<-04>4"
const char* TZ_INFO = "<-03>3";

// Coordenadas para o clima (Open-Meteo, não precisa de chave de API)
const float LATITUDE  = -15.79f;   // Brasília (troque pela sua cidade)
const float LONGITUDE = -47.88f;

const uint32_t WEATHER_INTERVAL_MS = 15UL * 60UL * 1000UL;  // clima a cada 15 min
const int FULL_REFRESH_EVERY = 30;  // refresh completo a cada 30 atualizações parciais

// ---------- Pinos (ESP32-S3) ----------
// Evite GPIO 35/36/37 (PSRAM octal), 26-32 (flash), 19/20 (USB) e 0/3/45/46 (strapping).
#define EPD_BUSY 4
#define EPD_RST  5
#define EPD_DC   6
#define EPD_CS   7
#define EPD_SCK  15   // pino "SCL" do display
#define EPD_MOSI 16   // pino "SDA" do display
#define BTN_KEY  45   // botão "IO45 KEY" da placa: força atualização completa

GxEPD2_BW<GxEPD2_154_D67, GxEPD2_154_D67::HEIGHT> display(
    GxEPD2_154_D67(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

// ---------- Estado ----------
struct Weather {
  bool valid = false;
  float temp = 0, tmin = 0, tmax = 0;
  int humidity = 0;
  int code = 0;
} weather;

uint32_t lastWeatherMs = 0;
int lastMinute = -1;
int partialCount = 0;

const char* DIAS[]  = {"Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"};
const char* MESES[] = {"Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
                       "Jul", "Ago", "Set", "Out", "Nov", "Dez"};

// Códigos WMO do Open-Meteo -> texto curto (fontes GFX não têm acento)
const char* weatherText(int c) {
  if (c == 0) return "Ceu limpo";
  if (c <= 2) return "Parc. nublado";
  if (c == 3) return "Nublado";
  if (c <= 48) return "Neblina";
  if (c <= 57) return "Garoa";
  if (c <= 67) return "Chuva";
  if (c <= 77) return "Neve";
  if (c <= 82) return "Pancadas";
  return "Tempestade";
}

// ---------- Rede ----------
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Conectando Wi-Fi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(250);
    Serial.print('.');
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK" : " falhou");
}

void updateWeather() {
  connectWiFi();
  if (WiFi.status() != WL_CONNECTED) return;

  char url[256];
  snprintf(url, sizeof(url),
           "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f"
           "&current=temperature_2m,relative_humidity_2m,weather_code"
           "&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto",
           LATITUDE, LONGITUDE);

  WiFiClientSecure client;
  client.setInsecure();  // simplificação: não valida o certificado
  HTTPClient http;
  if (!http.begin(client, url)) return;

  int status = http.GET();
  if (status == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getStream())) {
      weather.temp     = doc["current"]["temperature_2m"];
      weather.humidity = doc["current"]["relative_humidity_2m"];
      weather.code     = doc["current"]["weather_code"];
      weather.tmax     = doc["daily"]["temperature_2m_max"][0];
      weather.tmin     = doc["daily"]["temperature_2m_min"][0];
      weather.valid    = true;
    }
  } else {
    Serial.printf("Clima: HTTP %d\n", status);
  }
  http.end();
}

// ---------- Desenho ----------
void printCentered(const char* txt, int y) {
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds(txt, 0, y, &x1, &y1, &w, &h);
  display.setCursor((display.width() - w) / 2 - x1, y);
  display.print(txt);
}

// As fontes GFX não têm "°": desenha um pequeno círculo
void drawDegree(int x, int y, int r) {
  display.drawCircle(x + r, y + r, r, GxEPD_BLACK);
}

void drawScreen(const struct tm& t) {
  char buf[32];

  // Cabeçalho: data + indicador de Wi-Fi
  display.setFont(&FreeSansBold9pt7b);
  snprintf(buf, sizeof(buf), "%s, %02d %s", DIAS[t.tm_wday], t.tm_mday, MESES[t.tm_mon]);
  display.setCursor(6, 18);
  display.print(buf);
  if (WiFi.status() == WL_CONNECTED) {
    for (int i = 0; i < 3; i++)  // barrinhas de sinal
      display.fillRect(178 + i * 6, 16 - (i + 1) * 4, 4, (i + 1) * 4, GxEPD_BLACK);
  }
  display.drawFastHLine(0, 26, 200, GxEPD_BLACK);

  // Hora grande
  display.setFont(&FreeSansBold24pt7b);
  snprintf(buf, sizeof(buf), "%02d:%02d", t.tm_hour, t.tm_min);
  printCentered(buf, 82);

  display.drawFastHLine(0, 100, 200, GxEPD_BLACK);

  // Clima
  if (!weather.valid) {
    display.setFont(&FreeSans9pt7b);
    printCentered("Sem dados de clima", 150);
    return;
  }

  display.setFont(&FreeSansBold18pt7b);
  snprintf(buf, sizeof(buf), "%.0f", weather.temp);
  display.setCursor(8, 140);
  display.print(buf);
  int16_t cx = display.getCursorX();
  drawDegree(cx + 2, 116, 4);
  display.setCursor(cx + 12, 140);
  display.print("C");

  display.setFont(&FreeSans9pt7b);
  display.setCursor(108, 122);
  snprintf(buf, sizeof(buf), "Umid %d%%", weather.humidity);
  display.print(buf);
  display.setCursor(108, 142);
  snprintf(buf, sizeof(buf), "%.0f / %.0f", weather.tmin, weather.tmax);
  display.print(buf);

  display.setFont(&FreeSansBold9pt7b);
  printCentered(weatherText(weather.code), 178);
}

void render(bool full) {
  struct tm t;
  if (!getLocalTime(&t, 100)) return;

  if (full) display.setFullWindow();
  else      display.setPartialWindow(0, 0, display.width(), display.height());

  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    drawScreen(t);
  } while (display.nextPage());

  lastMinute = t.tm_min;
}

// ---------- Setup / loop ----------
void setup() {
  Serial.begin(115200);
  pinMode(BTN_KEY, INPUT_PULLUP);

  SPI.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
  display.init(115200, true, 2, false);  // reset curto (2 ms) recomendado p/ módulos WeAct
  display.setRotation(0);                // 0..3 conforme a montagem na luminária
  display.setTextColor(GxEPD_BLACK);

  connectWiFi();
  configTzTime(TZ_INFO, "pool.ntp.org", "a.ntp.br");

  struct tm t;
  for (int i = 0; i < 20 && !getLocalTime(&t, 500); i++) {}

  updateWeather();
  lastWeatherMs = millis();
  render(true);
}

void loop() {
  bool forceFull = digitalRead(BTN_KEY) == LOW;
  if (forceFull) {
    while (digitalRead(BTN_KEY) == LOW) delay(10);  // espera soltar o botão
  }

  if (forceFull || millis() - lastWeatherMs > WEATHER_INTERVAL_MS) {
    updateWeather();
    lastWeatherMs = millis();
  }

  struct tm t;
  if (getLocalTime(&t, 100) && (t.tm_min != lastMinute || forceFull)) {
    // Refresh completo periodicamente (e à meia-noite) para limpar "fantasmas"
    bool full = forceFull || ++partialCount >= FULL_REFRESH_EVERY ||
                (t.tm_hour == 0 && t.tm_min == 0);
    if (full) partialCount = 0;
    render(full);
    display.powerOff();  // desliga a alta tensão do painel (mantém a RAM p/ o próximo parcial)
  }

  delay(500);
}
