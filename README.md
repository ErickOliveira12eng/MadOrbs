# Mad Orbs

Jogo de tiro online com Orbs, para navegador: <https://madorbs.com>.

Este repositório é o **código-fonte do jogo que roda no navegador**, publicado sob a
[GPL v3](LICENSE). O Mad Orbs é derivado do Babo Violent 2 (RndLabs, 2006), cujo
[código-fonte](https://github.com/Daivuk/BaboViolent2) e arquivos de conteúdo foram liberados
sob a GPL v3 por um dos criadores do jogo. A física, as armas e as regras vêm de lá; a origem de
cada arquivo de `public/assets/` está em [`docs/ASSETS.md`](docs/ASSETS.md) e
[`public/assets/NOTICE.txt`](public/assets/NOTICE.txt).

Ele é atualizado junto com o site: cada versão publicada no madorbs.com tem aqui o código
correspondente.

## O que tem aqui

- `src/sim/`: a simulação do jogo (física, armas, projéteis, regras, bots do treino).
- `src/client/`: gráficos (three.js), som, controles, efeitos e o HUD.
- `src/menu/`: a tela inicial.
- `src/net/`: as mensagens trocadas com o servidor.
- `src/i18n/`: os textos do jogo em inglês, português e espanhol.
- `public/`: os arquivos do jogo (mapas, sons, músicas, texturas, modelos 3D) e as páginas de guia.
- `tools/build-langs.ts`: escreve a página inicial de cada idioma no build.

O servidor das partidas online não faz parte deste repositório: ele roda só nas máquinas do
madorbs.com e não é distribuído.

## Como rodar

Pré-requisito: [Node.js](https://nodejs.org/) 22 ou mais novo.

```bash
git clone https://github.com/ErickOliveira12eng/MadOrbs.git
cd MadOrbs
npm install
npm run dev
```

Abra <http://localhost:5173> e escolha **Treinar com bots**: a partida roda inteira no navegador.
`npm run build` gera a página em `dist/`.

## Licença

GPL v3: veja [`LICENSE`](LICENSE). Você pode usar, estudar, modificar e redistribuir este código,
desde que as versões redistribuídas também sejam GPL v3 e venham com o código-fonte.
