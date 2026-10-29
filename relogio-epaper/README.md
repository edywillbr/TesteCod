# Relógio e-paper (ESP32-S3 + WeAct 1.54")

## Ligações: display → ESP32-S3

| Display (WeAct 1.54") | ESP32-S3 | Observação |
|---|---|---|
| VCC  | 3V3    | use 3,3 V |
| GND  | GND    | |
| SDA  | GPIO16 | MOSI (dados SPI) |
| SCL  | GPIO15 | SCK (clock SPI) |
| CS   | GPIO7  | |
| D/C  | GPIO6  | |
| RES  | GPIO5  | |
| BUSY | GPIO4  | |

Não use: GPIO 35/36/37 (PSRAM octal do módulo N16R8), 26–32 (flash), 19/20 (USB), 0/3/45/46 (strapping).

## Alimentação

```
Fonte USB 5V ──► USB-C JRC-C009 ──  V ──► pino 5V/VIN da placa
                                    G ──► GND da placa
                       (a placa gera os 3,3 V para o display no pino 3V3)
```

- **LM2596S é step-down (abaixador), não booster.** Precisa de ~1,5–2 V a mais na entrada do que na saída. Com 5 V do USB ele não entrega 5 V, então nesse caso não use. Ele serve se a luminária tiver fonte de 12 V/24 V: regule para **5,0 V com multímetro antes** de ligar a placa.
- Não ligue a fonte externa e o USB da placa ao mesmo tempo (pode devolver corrente para o PC). Para gravar o código, use só o USB da placa.
- Se um carregador USB-C↔USB-C não alimentar o módulo, provavelmente faltam os resistores CC de 5,1 kΩ. Use um cabo USB-A→C.
- Opcional: capacitor de 220–470 µF entre 5V e GND, perto da placa (picos de corrente do Wi-Fi).

## Arduino IDE

1. Bibliotecas: **GxEPD2**, **Adafruit GFX**, **ArduinoJson** (7.x).
2. Placa: **ESP32S3 Dev Module**. Flash Size 16MB, PSRAM **OPI PSRAM**, USB CDC On Boot **Enabled**.
3. Edite `WIFI_SSID`, `WIFI_PASS`, `TZ_INFO`, `LATITUDE`, `LONGITUDE` no início do sketch.
4. Grave o código. O botão **IO45 KEY** força uma atualização completa (tela + clima).

## Layout (200×200)

```
┌──────────────────────────┐
│ Qua, 29 Out          ▂▄▆ │  data + Wi-Fi
├──────────────────────────┤
│          14:37           │  hora (atualização parcial a cada minuto)
├──────────────────────────┤
│ 27°C        Umid 62%     │
│             19 / 31      │  clima (Open-Meteo, a cada 15 min)
│       Parc. nublado      │
└──────────────────────────┘
```
