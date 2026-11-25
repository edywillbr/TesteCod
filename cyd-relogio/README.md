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

## Saudação

No lugar de pressão, vento e nascer/pôr do sol, a coluna da esquerda mostra
"Bom dia" (5h–11h59), "Boa tarde" (12h–17h59) ou "Boa noite" (18h–4h59) seguido do
nome cadastrado em **Ajustes > Nome**. A umidade fica logo abaixo da descrição do tempo.

## Luz e alarme

Na tela do relógio, no canto inferior esquerdo:
- **LUZ**: 1º toque acende só a luz de baixo; 2º toque acende as duas.
  Os dois quadradinhos no botão mostram quais estão acesas (de cima / de baixo).
- **OFF**: apaga as duas.

Em **Ajustes > Alarme**: ativar/desativar, hora, minutos (±1 e ±5), dias da semana
(D S T Q Q S S) e **TESTAR**. No horário, as duas luzes piscam em ritmo com bipes no
alto-falante e a tela mostra **DESLIGAR**. Tocar em DESLIGAR para o toque e devolve as
luzes ao estado anterior; o alarme continua programado para os próximos dias até ser
desativado. Se ninguém desligar, ele para sozinho após 10 minutos.

### Ligações

| Função | Pino da CYD | Onde fica |
|---|---|---|
| Luz de baixo (estágio 1) | GPIO22 | conector lateral (CN1/P3) |
| Luz de cima (estágio 2) | GPIO27 | conector lateral (CN1) |
| Alto-falante | conector **SPEAK** | já tem amplificador na placa (GPIO26) |

As lâmpadas são placas de LED de **5 V** (modelo 2835-24D-5V, 47 mm): 24 LEDs 2835 em
8 grupos de 3, cada grupo com um resistor de 27 Ω ("270") já na placa. Não precisam de
resistor nem diodo extra. Consumo estimado: cerca de **0,6 A por lâmpada** (~3 W), ou seja,
~1,2 A com as duas acesas, mais ~0,25 A da placa.

O pino do ESP32 não aguenta essa corrente: cada lâmpada é chaveada por um **MOSFET canal N
logic-level** (ex.: IRLB8721 ou IRLZ44N, de furo; AO3400 em módulo SMD; ou um módulo pronto
"MOSFET trigger" com AOD4184):

```
5V  ───────────── (+) lâmpada (−) ──── Dreno
                                         │
GPIO22 ── 220 Ω ── Gate                  │    (MOSFET)
                    │                    │
                  100 kΩ                 │
                    │                    │
GND ────────────────┴────────────── Fonte┘
```

Repita para a luz de cima no GPIO27. O resistor de 100 kΩ mantém a lâmpada apagada
enquanto a placa liga.

### Alimentação

Com as duas lâmpadas a corrente passa de 1,4 A, então:
- Use um carregador USB de **5 V e pelo menos 2 A** (a porta USB de um computador não basta).
- **Não** puxe a corrente das lâmpadas pelo USB da CYD: ela passaria pelo conector e pelo
  diodo da placa, que esquentam. Entre com o 5 V pelo módulo USB-C avulso (JRC-C009) e
  divida em dois caminhos: um para as lâmpadas (via MOSFETs) e outro para o pino **VIN**
  do conector P1 da CYD. Todos os GND juntos.
- Coloque um capacitor de 470–1000 µF / 10 V entre 5 V e GND perto das lâmpadas: no
  alarme elas piscam juntas e os picos de corrente podem reiniciar a placa.
- Para gravar o firmware pelo USB da CYD, desligue a alimentação externa.

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
- Saudação com nome do usuário (`src/app/greeting.cpp`) no lugar de pressão, vento e
  nascer/pôr do sol; item **Nome** nos ajustes.
- Luz em dois estágios e alarme com dias da semana (`src/app/alarm.cpp`). Os botões LUZ/OFF
  ocupam o lugar do texto da fase da lua (o ícone da lua continua).
- Verificação de atualização (OTA) desativada: o canal do autor instalaria o firmware dele
  por cima desta versão (`VERSION_CHECK_URL` vazio em `main.cpp`).
