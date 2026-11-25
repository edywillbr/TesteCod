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

- Placa: ESP32-2432S028R com controlador **ILI9341** (modelo com uma entrada micro-USB).
  O modelo com duas entradas (USB-C + micro-USB) costuma usar outro controlador e
  pode mostrar cores erradas.
- Alimentação: USB da própria placa (5 V). Não precisa de fiação para a tela.
- Montagem de cabeça para baixo: em Configurações > Graphics, opção **FLP** (180°).

## Como compilar e gravar

1. Instale o **VS Code** e a extensão **pioarduino** (fork do PlatformIO com o core 3.x do ESP32).
2. Abra esta pasta (`cyd-relogio/`) no VS Code.
3. Conecte o CYD no USB e rode: `pio run -e release -t upload`
   (ou o botão "Upload" do ambiente `release`).
4. Monitor serial: `pio device monitor` (115200).

Se a porta não for detectada sozinha, descomente `upload_port` no `platformio.ini`
(Windows: `COM3`, `COM4`...; Linux: `/dev/ttyUSB0`).

Na primeira vez a tela abre a configuração de Wi-Fi: escolha a rede e digite a senha
pelo toque.

## Mudanças em relação ao original

- `platformio.ini`: porta serial fixa do macOS comentada (detecção automática).

## Próximas adaptações planejadas

- Desativar a atualização OTA que aponta para o repositório do autor
  (instalar uma atualização de lá apagaria as nossas mudanças).
- Traduzir a interface para português (sem acentos: as fontes não têm).
- Trocar o "dia do nome" tcheco pelos feriados do Brasil.
- Controle da luz da luminária pela tela (GPIO 22 ou 27 + MOSFET).
