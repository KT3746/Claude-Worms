/**
 * O arsenal, em tabela — no mesmo espírito de `js/game/levels.js`.
 *
 * O motor sabe executar cada `tipo`; uma arma nova é uma linha aqui, não um
 * arquivo novo. Os seis tipos previstos são `projetil`, `granada`, `hitscan`,
 * `soltavel`, `dirigivel` e `utilitario`. Esta entrega cobre os cinco
 * primeiros com armas de verdade; `utilitario` (corda ninja, jetpack,
 * teleporte, viga) tem mecânica própria grande o bastante para ser o marco
 * seguinte, e por isso fica de fora daqui.
 */

export const ARMAS = [
  {
    id: 'bazuca',
    nome: 'Bazuca',
    tipo: 'projetil',
    municao: Infinity,
    vento: true,            // sofre vento
    velocidadeMax: 26,      // m/s com a força no máximo
    raio: 2.4,              // raio da explosão, em metros
    dano: 45,
    impulso: 11,
    encerraTurno: true,
    miravel: true,
    dica: 'Leia o vento antes de soltar.',
  },
  {
    id: 'morteiro',
    nome: 'Morteiro',
    tipo: 'projetil',
    municao: Infinity,
    vento: true,
    velocidadeMax: 17,      // mais lento: o vento tem mais tempo para agir
    raio: 3.1,
    dano: 40,
    impulso: 9,
    encerraTurno: true,
    miravel: true,
    dica: 'Mais lento, estrago maior.',
  },
  {
    id: 'granada',
    nome: 'Granada',
    tipo: 'granada',
    municao: Infinity,
    vento: false,
    velocidadeMax: 20,
    raio: 2.2,
    dano: 40,
    impulso: 10,
    pavio: 3,               // segundos
    restituicao: 0.42,      // quica
    atrito: 0.3,
    encerraTurno: true,
    miravel: true,
    ajustavel: true,        // o pavio muda com 1–5
    dica: 'Quica. Use 1 a 5 para mudar o pavio.',
  },
  {
    id: 'fragmentacao',
    nome: 'Frag. em cacho',
    tipo: 'granada',
    municao: Infinity,
    vento: false,
    velocidadeMax: 18,
    raio: 1.3,
    dano: 22,
    impulso: 7,
    pavio: 2.2,
    restituicao: 0.38,
    atrito: 0.32,
    encerraTurno: true,
    miravel: true,
    ajustavel: true,
    // Ao explodir, espalha pedaços menores — ver MINI_FRAGMENTO e detonar() em match.js.
    cacho: { quantidade: 5, velocidadeMin: 3, velocidadeMax: 6.5, pavio: 0.6 },
    dica: 'Explode em 5 pedaços menores.',
  },
  {
    id: 'dinamite',
    nome: 'Dinamite',
    tipo: 'soltavel',
    municao: Infinity,
    vento: false,
    raio: 3.2,
    dano: 65,
    impulso: 13,
    pavio: 5,
    restituicao: 0.1,
    atrito: 0.75,
    encerraTurno: true,
    miravel: false,         // larga no pé, não mira
    dica: 'Larga no chão. Corra.',
  },
  {
    id: 'mina',
    nome: 'Mina',
    tipo: 'soltavel',
    municao: Infinity,
    vento: false,
    raio: 2.6,
    dano: 50,
    impulso: 11,
    restituicao: 0.05,
    atrito: 1,
    assentaSemExplodir: true, // não explode ao tocar o chão — só por proximidade
    proximidade: 2.2,         // raio de detecção, em metros
    atraso: 1.5,              // segundos até armar, para quem a larga escapar
    encerraTurno: true,
    miravel: false,
    dica: 'Arma sozinha. Explode quando alguém chega perto.',
  },
  {
    id: 'escopeta',
    nome: 'Escopeta',
    tipo: 'hitscan',
    municao: Infinity,
    disparos: 2,             // dois tiros no mesmo turno
    espalhamento: 0.05,       // radianos de desvio aleatório por tiro
    alcanceMax: 9,
    dano: 14,
    impulso: 4,
    furoRaio: 0.12,           // furo visual no terreno onde bate
    encerraTurno: true,
    miravel: true,
    recuoImediato: true,      // sem tempo de voo: o recuo começa na hora
    dica: 'Dois tiros curtos, sem vento.',
  },
  {
    id: 'sniper',
    nome: 'Rifle sniper',
    tipo: 'hitscan',
    municao: Infinity,
    disparos: 1,
    espalhamento: 0,
    alcanceMax: 70,
    dano: 34,
    impulso: 2,
    furoRaio: 0.08,
    encerraTurno: true,
    miravel: true,
    recuoImediato: true,
    dica: 'Longo alcance. Sem segunda chance.',
  },
  {
    id: 'ovelha',
    nome: 'Ovelha',
    tipo: 'dirigivel',
    modo: 'andar',            // pousa e anda sozinha
    municao: Infinity,
    velocidadeMax: 6.5,       // impulso do salto inicial
    raio: 3.4,
    dano: 60,
    impulso: 12,
    pavio: 6,                 // segundos andando até explodir sozinha
    proximidade: 1.4,         // ou antes, se encostar em alguém
    encerraTurno: true,
    miravel: true,
    dica: 'Pula, anda sozinha e explode. Cuidado onde solta.',
  },
  {
    id: 'missil',
    nome: 'Míssil guiado',
    tipo: 'dirigivel',
    modo: 'reto',             // voo reto na mira, sem gravidade nem vento
    municao: Infinity,
    velocidadeMax: 22,
    raio: 2.6,
    dano: 42,
    impulso: 10,
    encerraTurno: true,
    miravel: true,
    dica: 'Voa reto na mira. Ignora vento e gravidade.',
  },
  {
    id: 'corda',
    nome: 'Corda ninja',
    tipo: 'utilitario',
    acao: 'corda',
    municao: Infinity,
    encerraTurno: false,      // usar a corda não passa a vez
    miravel: true,
    comprimentoMax: 45,
    comprimentoMin: 1.5,
    dica: 'Mira numa saliência e atira. Espaço de novo solta. ↑ ↓ encolhem e alongam.',
  },
  {
    id: 'jetpack',
    nome: 'Jetpack',
    tipo: 'utilitario',
    acao: 'jetpack',
    municao: Infinity,
    encerraTurno: false,
    miravel: false,
    combustivel: 3.5,         // segundos de impulso por turno
    empuxo: 13,
    empuxoLateral: 7,
    dica: 'Segure Espaço para subir. ← → empurram de lado.',
  },
  {
    id: 'teleporte',
    nome: 'Teleporte',
    tipo: 'utilitario',
    acao: 'teleporte',
    municao: Infinity,
    encerraTurno: false,
    miravel: true,
    alcanceMax: 16,
    dica: 'Aparece onde a mira aponta.',
  },
  {
    id: 'viga',
    nome: 'Viga',
    tipo: 'soltavel',
    municao: Infinity,
    vento: false,
    assentaSemExplodir: true, // não explode: vira chão ao assentar
    construir: { largura: 2.6, altura: 0.5 },
    restituicao: 0.05,
    atrito: 1,
    encerraTurno: true,
    miravel: false,
    dica: 'Larga no chão e vira degrau sólido.',
  },
];

/**
 * Os pedaços de uma granada de fragmentação. Não aparece no seletor do
 * jogador (`oculta`) — é criada internamente por `detonar()` em match.js.
 */
export const MINI_FRAGMENTO = {
  id: 'mini-fragmento',
  nome: 'Fragmento',
  tipo: 'granada',
  vento: false,
  raio: 1.1,
  dano: 16,
  impulso: 6,
  restituicao: 0.3,
  atrito: 0.4,
  oculta: true,
};

export function armaPorId(id) {
  return ARMAS.find((a) => a.id === id) ?? ARMAS[0];
}

/** Índice de uma arma na lista, para o carrossel `[` `]`. */
export function indiceDaArma(arma) {
  const i = ARMAS.indexOf(arma);
  return i === -1 ? 0 : i;
}

/** Próxima arma no carrossel, ciclando. */
export function armaSeguinte(arma, direcao = 1) {
  const i = indiceDaArma(arma);
  const proximo = (i + direcao + ARMAS.length) % ARMAS.length;
  return ARMAS[proximo];
}
