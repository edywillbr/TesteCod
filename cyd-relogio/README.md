# Relógio CYD (Cheap Yellow Display)

Relógio de mesa com data, fase da lua, feriados e clima para a placa
**ESP32-2432S028R** ("Cheap Yellow Display", tela 2,8" 320×240 com toque),
para ser acoplado à luminária.

## Origem

Código baseado no **CYD_DD v2.1.1** de Xylopyrographer
(https://github.com/Xylopyrographer/CYD_DD/releases/tag/v2.1.1),
que por sua vez vem de https://github.com/lachimalaif/DataDisplay-V1-instalator.

O repositório original não tem arquivo de licença. Esta cópia é só para uso
pessoal; para publicar ou distribuir, peça permissão ao autor.
O README original está em `README-original.md`.

## Hardware

- Placa: ESP32-2432S028R de **duas entradas** (USB-C + micro-USB), com painel **ST7789**.
  É o ambiente padrão (`cyd2usb`) do `platformio.ini`.
  Para o modelo de uma entrada (ILI9341), use o ambiente `release`.
  Se vermelho e azul saírem trocados, descomente `-D CYD_RGB` em `[env:cyd2usb]`.
- Alimentação: USB da própria placa (5 V). Não precisa de fiação para a tela.
- Montagem de cabeça para baixo: em Configurações > Graphics, opção **FLP** (180°).

## Como compilar e gravar

1. Instale o **VS Code** e a extensão **pioarduino** (fork do PlatformIO com o core 3.x do ESP32).
2. Abra esta pasta (`cyd-relogio/`) no VS Code.
3. Conecte o CYD no USB e rode: `pio run -e cyd2usb -t upload`
   (ou o botão "Upload" do ambiente `cyd2usb`).
   Para gerar um `.bin` único (gravar no endereço 0x0 pelo web.esphome.io):
   `pio run -e cyd2usb -t merged` → arquivo em `bin/`.
4. Monitor serial: `pio device monitor` (115200).

Se a porta não for detectada sozinha, descomente `upload_port` no `platformio.ini`
(Windows: `COM3`, `COM4`...; Linux: `/dev/ttyUSB0`).

Na primeira vez a tela abre a configuração de Wi-Fi: escolha a rede e digite a senha
pelo toque.

## Mudanças em relação ao original

- `platformio.ini`: porta serial fixa do macOS comentada (detecção automática).
- Suporte ao CYD de duas entradas USB (painel ST7789): ambiente `cyd2usb`, flag `CYD_2USB`
  em `include/User_Setup.h` (ST7789, ordem BGR, sem inversão extra).
- Interface em português do Brasil, sem acentos (as fontes não têm): textos das telas,
  data por extenso, dias da semana, clima, fases da lua e direções do vento (L/O).
- `semAcentos()` em `src/util/string_utils.cpp`: remove acentos de nomes de cidade e feriados
  (antes "Brasília" aparecia como "Braslia").
- Feriados no nome local (Nager.Date `localName`) e busca de cidades em português.

## Próximas adaptações planejadas

- Desativar a atualização OTA que aponta para o repositório do autor
  (instalar uma atualização de lá apagaria as nossas mudanças).
- Controle da luz da luminária pela tela (GPIO 22 ou 27 + MOSFET).
