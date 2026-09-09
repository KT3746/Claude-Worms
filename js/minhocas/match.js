/**
 * A partida: mundo, equipes, ordem de jogo, vento, água e regras.
 *
 * É aqui que os módulos puros se encontram com a câmera, as partículas e o
 * som. A lógica que dá para testar sem navegador mora nos outros arquivos —
 * este é o fio que costura tudo.
 */

import { createRng, randomSeed } from '../engine/rng.js';
import { sfx } from '../engine/audio.js';

import { gerarTerreno } from './terrain-gen.js';
import { createTerrain } from './terrain.js';
import { createTurnMachine, FASE } from './turn.js';
import { ARMAS, MINI_FRAGMENTO, armaPorId, armaSeguinte } from './weapons.js';
import { createProjectile, atualizarProjetil, projetilParado, desenharProjetil } from './projectile.js';
import { explosao } from './damage.js';
import { GRAVIDADE, ARRASTO, interseccaoSegmentoCirculo } from './ballistics.js';
import * as Worm from './worm.js';
import * as Rope from './rope.js';

const NOMES = [
  'Tico', 'Bala', 'Rabo', 'Zé', 'Pipa', 'Nino', 'Vovô', 'Chico',
  'Dona', 'Lelê', 'Bento', 'Tuca', 'Juju', 'Meme', 'Zóio', 'Pila',
];

/** Explosão da minhoca que morre — é o que encadeia mortes. */
const EXPLOSAO_DE_MORTE = { raio: 1.9, dano: 28, impulso: 8 };

/** A água sobe isto por turno depois da morte súbita. */
const SUBIDA_AGUA = 0.22;

/**
 * Faixa do zoom ajustável pelo jogador (`comandos.ajustarZoom`). 0,5 mostra
 * o dobro de mapa ao redor da minhoca; 1,2 é mais perto que o padrão de
 * sempre, pra quem quer precisão em vez de contexto.
 */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.2;
const PASSO_ZOOM = 0.1;

/** Forma de uma nuvem: deslocamento e raio de cada bolha, em unidades de escala. */
const BOLHAS_DE_NUVEM = [
  [-1.6, 0.15, 0.85],
  [-0.6, -0.25, 1.15],
  [0.6, -0.1, 1.0],
  [1.7, 0.2, 0.75],
];

export function createMatch({
  semente = randomSeed(),
  equipes = [
    { nome: 'Vermelhos', minhocas: 4 },
    { nome: 'Azuis', minhocas: 4 },
  ],
  camera,
  particles,
  motionEnabled = true,
  tempoTurno = 45,
  zoom = 1,
} = {}) {
  const rng = createRng(semente);
  const dados = gerarTerreno({ rng });
  const terreno = createTerrain(dados);
  terreno.repintarTudo(); // ainda na tela de carregamento: nenhum quadro de jogo paga por isto

  camera.setBounds({ minX: 0, maxX: terreno.largura, minY: 0, maxY: terreno.altura });

  // ---------------------------------------------------------- equipes

  const nomesDisponiveis = rng.shuffle([...NOMES]);
  let contadorNomes = 0;

  const pontos = escolherNascimentos(
    terreno.nascimentos,
    equipes.reduce((n, e) => n + e.minhocas, 0),
    rng,
  );

  let p = 0;
  const times = equipes.map((cfg, indice) => {
    const minhocas = [];
    for (let i = 0; i < cfg.minhocas; i += 1) {
      const ponto = pontos[p] ?? terreno.nascimentos[0];
      p += 1;
      minhocas.push(Worm.createWorm({
        nome: nomesDisponiveis[contadorNomes++ % nomesDisponiveis.length],
        equipe: indice,
        x: ponto.x,
        y: ponto.y + 0.1,
      }));
    }
    return {
      nome: cfg.nome,
      indice,
      cores: Worm.coresDaEquipe(indice),
      minhocas,
      atual: -1,
      // Time de mentira: joga sozinho pelo `ai.js`, sem teclado nem toque.
      // Ver `criarAdversarioIA` em `ai.js` e a seleção na tela de configuração.
      ia: cfg.ia === true,
      get vida() {
        return minhocas.reduce((s, w) => s + (w.vivo ? Math.max(0, w.vida) : 0), 0);
      },
      get viva() {
        return minhocas.some((w) => w.vivo);
      },
    };
  });

  const todas = times.flatMap((t) => t.minhocas);

  // ------------------------------------------------------------ estado

  const estado = {
    semente,
    terreno,
    times,
    todas,
    projeteis: [],
    criaturas: [],  // corpos dirigíveis que andam sozinhos (a ovelha)
    tracos: [],     // traços visuais de tiros instantâneos (escopeta, sniper)
    vento: 0,
    nivelAgua: terreno.nivelAgua,
    ativa: null,
    equipeDaVez: -1,
    arma: ARMAS[0],
    pavio: 3,
    carga: 0,
    carregando: false,
    corda: null,            // {x,y,vx,vy,pivos,sentidos,L,limiteMin,limiteMax} enquanto presa
    jetpackCombustivel: 0,
    mensagem: '',
    tempoMensagem: 0,
    motionEnabled,
    // Multiplica toda escala de câmera de mira/acompanhamento abaixo — 1 é o
    // padrão de sempre, menor afasta a câmera pra ver mais mapa em volta
    // da minhoca (útil sobretudo no celular, onde a tela é pequena e o
    // inimigo fica fora da vista com o zoom padrão). Ajustável em jogo por
    // `comandos.ajustarZoom()`, e persistido em `save.settings.zoom`.
    zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoom * 100) / 100)),
    slowmo: 1,
    tempoAgua: 0,
    fimDeJogo: false,
    vencedor: null,
  };

  const COMBUSTIVEL_JETPACK = armaPorId('jetpack').combustivel;

  const ambiente = () => ({ gravidade: GRAVIDADE, arrasto: ARRASTO, vento: estado.vento });

  // ------------------------------------------------------- turnos

  const turnos = createTurnMachine({
    tempoTurno,
    equipes: times.length,
    hooks: {
      aoPreparar() {
        estado.carga = 0;
        estado.carregando = false;
        estado.corda = null;
        estado.jetpackCombustivel = COMBUSTIVEL_JETPACK;
        estado.arma = ARMAS[0];
        estado.pavio = ARMAS[1].pavio;
        estado.vento = Math.round(rng.range(-9, 9) * 10) / 10;
        estado.ativa = proximaMinhoca();
        if (estado.ativa) {
          camera.lookAt(estado.ativa.x, estado.ativa.y + 1, 26 * estado.zoom);
          sfx.vez();
        }
      },
      aoDisparar() {
        estado.carregando = false;
      },
      aoResolver: resolverConsequencias,
      aoMorteSubita() {
        anunciar('Morte súbita! A água está subindo.');
        sfx.sirene();
      },
      aoSubirAgua() {
        estado.nivelAgua += SUBIDA_AGUA;
      },
      aoFim(vencedor) {
        estado.fimDeJogo = true;
        estado.vencedor = vencedor;
      },
    },
  });

  function proximaMinhoca() {
    for (let salto = 1; salto <= times.length; salto += 1) {
      const idx = (estado.equipeDaVez + salto) % times.length;
      const time = times[idx];
      if (!time.viva) continue;
      estado.equipeDaVez = idx;
      for (let k = 1; k <= time.minhocas.length; k += 1) {
        const j = (time.atual + k) % time.minhocas.length;
        if (time.minhocas[j].vivo) {
          time.atual = j;
          return time.minhocas[j];
        }
      }
    }
    return null;
  }

  function anunciar(texto, segundos = 2.6) {
    estado.mensagem = texto;
    estado.tempoMensagem = segundos;
  }

  // ---------------------------------------------------- consequências

  /**
   * Roda entre o "tudo parou" e o próximo turno: mata quem chegou a zero,
   * afoga quem passou da linha d'água e devolve `true` se algo aconteceu —
   * o que faz a máquina esperar tudo assentar de novo (mortes em cadeia).
   */
  function resolverConsequencias() {
    let houve = false;

    for (const w of todas) {
      if (!w.vivo) continue;

      if (w.y < estado.nivelAgua) {
        w.vivo = false;
        respingar(w.x, estado.nivelAgua);
        sfx.respingo();
        anunciar(`${w.nome} se afogou.`);
        houve = true;
        continue;
      }

      if (w.vida <= 0) {
        w.vivo = false;
        w.vida = 0;
        detonar(w.x, w.y + Worm.ALTURA * 0.4, EXPLOSAO_DE_MORTE);
        anunciar(`${w.nome} explodiu.`);
        houve = true;
      }
    }

    return houve;
  }

  /**
   * Uma mina assentada (`apoiado`) já não está "em jogo" para efeito de
   * turno — ela é uma armadilha que fica no mapa por rodadas, esperando
   * alguém chegar perto. Contá-la como projétil ativo travaria o turno para
   * sempre, já que nada garante que ela vá explodir logo.
   */
  function bloqueiaTurno(p) {
    return !(p.arma.assentaSemExplodir && p.apoiado);
  }

  function contexto() {
    const vivas = times.filter((t) => t.viva);
    const emJogo = estado.projeteis.filter(bloqueiaTurno);
    return {
      tudoParado: todas.every(Worm.estaParada) && estado.projeteis.every(projetilParado),
      // A ovelha conta como "no ar" enquanto existir, mesmo andando parada
      // no acumulador de física — senão o turno passaria com ela a meio caminho.
      projeteisAtivos: emJogo.length + estado.criaturas.length,
      equipesVivas: vivas.length,
      equipeVencedora: vivas.length === 1 ? vivas[0] : null,
    };
  }

  // ------------------------------------------------------- explosões

  function detonar(x, y, arma) {
    terreno.explodir(x, y, arma.raio);

    for (const efeito of explosao(todas, x, y, arma)) {
      const w = efeito.corpo;
      w.vida -= efeito.dano;
      w.piscar = 0.45;

      // Uma explosão perto de quem está pendurado na corda tem de soltá-la
      // primeiro: `Worm.empurrar` força `estado = 'voando'`, mas sem largar
      // a corda aqui `estado.corda` continuaria presa e, no próximo quadro,
      // `Rope.passo` reescreveria x/y/vx/vy por cima do empurrão, anulando
      // o impacto da explosão.
      if (w === estado.ativa && estado.corda) largarCorda();

      Worm.empurrar(w, efeito.impulso.x, efeito.impulso.y);
      if (efeito.dano > 4) sfx.ai();
    }

    // Detritos com a cor de quem foi atingido, fumaça e clarão.
    const quantidade = Math.round(24 + arma.raio * 12);
    for (let i = 0; i < quantidade; i += 1) {
      const a = rng.range(0, Math.PI * 2);
      const v = rng.range(2, 4 + arma.raio * 2.2);
      particles.spawn({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + 2,
        life: rng.range(0.5, 1.4),
        size: rng.range(0.05, 0.16),
        color: i % 4 === 0 ? '#6aa84f' : '#96653e',
        gravity: 11,
        drag: 0.5,
      });
    }
    for (let i = 0; i < 14; i += 1) {
      particles.spawn({
        x: x + rng.range(-arma.raio, arma.raio) * 0.5,
        y: y + rng.range(-arma.raio, arma.raio) * 0.5,
        vx: rng.range(-1.2, 1.2),
        vy: rng.range(0.6, 2.4),
        life: rng.range(0.7, 1.6),
        size: rng.range(0.2, 0.5),
        color: 'rgba(226, 226, 226, 0.45)',
        gravity: -1.2,
        drag: 1.6,
      });
    }

    camera.addShake(Math.min(1, arma.raio * 0.22));
    sfx.explosao(arma.raio);

    // Granada de fragmentação: a explosão principal acontece igual à de
    // qualquer outra granada, e além dela nascem pedaços menores que se
    // espalham e explodem sozinhos pouco depois.
    if (arma.cacho) {
      for (let i = 0; i < arma.cacho.quantidade; i += 1) {
        const angulo = rng.range(0, Math.PI * 2);
        const velocidade = rng.range(arma.cacho.velocidadeMin, arma.cacho.velocidadeMax);
        estado.projeteis.push(createProjectile({
          arma: MINI_FRAGMENTO,
          x,
          y,
          vx: Math.cos(angulo) * velocidade,
          vy: Math.abs(Math.sin(angulo)) * velocidade + 1.5, // sempre espalha para cima
          pavio: arma.cacho.pavio,
        }));
      }
    }
  }

  function respingar(x, y) {
    for (let i = 0; i < 26; i += 1) {
      particles.spawn({
        x: x + rng.range(-0.4, 0.4),
        y,
        vx: rng.range(-2.4, 2.4),
        vy: rng.range(2.5, 6.5),
        life: rng.range(0.4, 1),
        size: rng.range(0.05, 0.13),
        color: '#7fc4e8',
        gravity: 12,
        drag: 0.6,
      });
    }
  }

  // ---------------------------------------------------------- comandos

  const comandos = {
    andar(dir, dt) {
      if (!podeAgir()) return;

      // Na corda, ←/→ não andam — dão um empurrão para "bombear" o balanço.
      if (estado.corda) {
        estado.corda.vx += dir * 5 * dt;
        estado.ativa.direcao = dir;
        return;
      }
      // De jetpack ligado e no ar, ←/→ empurram de lado em vez de andar
      // (Worm.andar já não faz nada com a minhoca voando, então isto só
      // acrescenta controle, nunca compete com o andar normal no chão).
      if (estado.arma.acao === 'jetpack' && estado.ativa.estado === 'voando') {
        estado.ativa.vx += dir * estado.arma.empuxoLateral * dt;
        estado.ativa.direcao = dir;
        return;
      }
      Worm.andar(estado.ativa, terreno, dir, dt);
    },

    mirar(delta) {
      if (!podeAgir()) return;

      // Presa na corda, ↑/↓ encolhem/alongam em vez de mirar — é assim que
      // se sobe e desce pendurado.
      if (estado.corda) {
        estado.corda = Rope.ajustarComprimento(estado.corda, -delta * 4, {
          comprimentoMin: estado.corda.limiteMin,
          comprimentoMax: estado.corda.limiteMax,
        });
        return;
      }
      const w = estado.ativa;
      w.angulo = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, w.angulo + delta));
    },

    virar(dir) {
      if (!podeAgir()) return;
      estado.ativa.direcao = dir;
    },

    /**
     * Um passo de zoom: `direcao` negativa afasta a câmera (mais mapa à
     * vista), positiva aproxima. Devolve o novo zoom, para persistir, ou
     * `null` se já estava no limite e nada mudou.
     *
     * Diferente dos outros comandos, não passa por `podeAgir()`: é uma
     * preferência de visão, não uma jogada — funciona em qualquer fase,
     * inclusive na vez da IA, pra quem só está assistindo. Reaplica a
     * câmera na hora (via `seguirCamera`), senão o efeito só apareceria na
     * próxima vez que alguma outra coisa mexesse nela.
     */
    ajustarZoom(direcao) {
      // Arredondado a 2 casas: passos de 0,1 somados em ponto flutuante
      // derivam (0,5 vira 0,5000000000000001), e aí nem um clamp exato no
      // piso nem uma comparação futura contra 0,5 batem certo.
      const bruto = estado.zoom + Math.sign(direcao) * PASSO_ZOOM;
      const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(bruto * 100) / 100));
      if (zoom === estado.zoom) return null;
      estado.zoom = zoom;
      seguirCamera(0);
      return zoom;
    },

    /**
     * Mira direto num ponto do mundo, virando a minhoca para o lado certo —
     * é o que o dedo (ou o mouse) faz arrastando pelo campo. `mirar()` anda
     * de pouquinho em pouquinho porque a tecla fica segurada; aqui o ponteiro
     * já diz o ângulo inteiro de uma vez.
     *
     * Presa na corda a mira não obedece (↑/↓ ali encolhem e alongam), então
     * arrastar também não deve mexer nela.
     */
    apontarPara(x, y) {
      if (!podeAgir() || estado.corda) return;
      const w = estado.ativa;
      const dx = x - w.x;
      const dy = y - (w.y + Worm.ALTURA * 0.55); // o mesmo pivô da boca da arma
      if (Math.hypot(dx, dy) < 0.05) return; // em cima da própria minhoca: sem direção

      w.direcao = dx >= 0 ? 1 : -1;
      // O ângulo é sempre medido a partir da frente da minhoca: quem inverte
      // o lado é `direcao`, então o eixo x entra em módulo. É isso, e não um
      // `clamp`, que garante os ±90° de `mirar()`: com x nunca negativo,
      // `atan2` já devolve exatamente essa faixa.
      w.angulo = Math.atan2(dy, Math.abs(dx));
    },

    pular(tipo) {
      if (!podeAgir()) return;
      Worm.pular(estado.ativa, terreno, tipo);
    },

    trocarArma(id) {
      if (!turnos.podeAtirar || estado.carregando || estado.corda) return;
      estado.arma = armaPorId(id);
    },

    /** Percorre o arsenal com `[` `]`. Não pula para a arma oculta do cacho. */
    trocarArmaRelativa(direcao) {
      if (!turnos.podeAtirar || estado.carregando || estado.corda) return;
      let proxima = estado.arma;
      do {
        proxima = armaSeguinte(proxima, direcao);
      } while (proxima.oculta && proxima !== estado.arma);
      estado.arma = proxima;
    },

    ajustarPavio(segundos) {
      if (!turnos.podeAtirar) return;
      estado.pavio = Math.max(1, Math.min(5, segundos));
    },

    /** Começa a carregar a força do tiro (ou dispara na hora, para quem não carrega). */
    carregar() {
      if (!turnos.podeAtirar || !estado.ativa) return;
      const arma = estado.arma;

      if (arma.acao === 'corda') {
        if (estado.corda) largarCorda();
        else lancarCorda();
        return;
      }
      if (arma.acao === 'teleporte') {
        usarTeleporte();
        return;
      }
      if (arma.acao === 'jetpack') return; // liga com impulsoJetpack(), não por aqui

      // Soltável e hitscan não têm força para acumular: disparam no toque.
      if (arma.tipo === 'soltavel' || arma.tipo === 'hitscan') {
        soltar();
        return;
      }
      estado.carregando = true;
      estado.carga = 0;
    },

    /** Solta e dispara com a força acumulada. */
    disparar() {
      if (!estado.carregando) return;
      soltar();
    },

    /** Chamado a cada quadro em que o jogador segura o botão do jetpack. */
    impulsoJetpack(dt) {
      if (!podeAgir() || estado.arma.acao !== 'jetpack' || estado.jetpackCombustivel <= 0) return;
      const w = estado.ativa;
      const gasto = Math.min(dt, estado.jetpackCombustivel);
      estado.jetpackCombustivel -= gasto;

      if (w.estado !== 'voando') {
        w.estado = 'voando';
        w.quedaMaxima = 0;
        w.tempoNoAr = 0;
      }
      w.vy += estado.arma.empuxo * gasto;
    },
  };

  function podeAgir() {
    return turnos.podeControlar && estado.ativa?.vivo && !estado.fimDeJogo;
  }

  /** Dispara a corda na direção da mira. Se não achar onde prender, avisa e não gasta nada. */
  function lancarCorda() {
    const w = estado.ativa;
    const arma = estado.arma;
    const boca = Worm.bocaDaArma(w, 0.3);
    const alcance = 60; // bem além do comprimento máximo — quem decide onde prende é o raio
    const alvoX = boca.x + Math.cos(w.angulo) * w.direcao * alcance;
    const alvoY = boca.y + Math.sin(w.angulo) * alcance;

    const nova = Rope.lancar(
      { x: w.x, y: w.y, vx: w.vx, vy: w.vy },
      alvoX, alvoY,
      (x0, y0, x1, y1) => terreno.raio(x0, y0, x1, y1),
    );

    if (!nova) {
      anunciar('Sem onde prender.', 1);
      return;
    }

    nova.limiteMin = arma.comprimentoMin;
    nova.limiteMax = arma.comprimentoMax;
    nova.L = Math.max(nova.limiteMin, Math.min(nova.limiteMax, nova.L));
    estado.corda = nova;
    w.estado = 'corda';
    sfx.corda();
  }

  /** Larga a corda: a minhoca sai voando com a velocidade que tinha. */
  function largarCorda() {
    if (!estado.corda) return;
    const livre = Rope.soltar(estado.corda);
    const w = estado.ativa;
    w.x = livre.x;
    w.y = livre.y;
    w.vx = livre.vx;
    w.vy = livre.vy;
    w.estado = 'voando';
    estado.corda = null;
  }

  /** Some no lugar e aparece onde a mira aponta, se houver espaço. */
  function usarTeleporte() {
    const w = estado.ativa;
    const alcance = estado.arma.alcanceMax;
    const destX = w.x + Math.cos(w.angulo) * w.direcao * alcance;
    const destY = w.y + Math.sin(w.angulo) * alcance;

    if (terreno.solidoEm(destX, destY)) {
      anunciar('Sem espaço para aparecer ali.', 1);
      return;
    }

    w.x = destX;
    w.y = destY;
    w.vx = 0;
    w.vy = 0;
    w.estado = 'voando';
    w.quedaMaxima = 0;
    sfx.teleporte();
  }

  function soltar() {
    const w = estado.ativa;
    if (!w || !turnos.podeAtirar) return;
    const arma = estado.arma;

    estado.carregando = false;

    if (arma.tipo === 'hitscan') {
      disparoHitscan(w, arma);
    } else if (arma.tipo === 'dirigivel' && arma.modo === 'andar') {
      lancarOvelha(w, arma);
    } else {
      const boca = Worm.bocaDaArma(w);
      const carga = Math.max(0.12, estado.carga);
      const solta = arma.tipo === 'soltavel';

      estado.projeteis.push(createProjectile({
        arma,
        x: solta ? w.x + w.direcao * 0.35 : boca.x,
        y: solta ? w.y + 0.25 : boca.y,
        vx: solta ? 0 : Math.cos(w.angulo) * w.direcao * arma.velocidadeMax * carga,
        vy: solta ? 0 : Math.sin(w.angulo) * arma.velocidadeMax * carga,
        dono: w,
        pavio: arma.tipo === 'granada' ? estado.pavio : arma.pavio,
      }));
      if (!solta) sfx.disparo();
    }

    estado.carga = 0;
    turnos.disparou(arma);
  }

  /**
   * Escopeta e sniper: sem tempo de voo, resolvidos no mesmo quadro do
   * disparo. O terreno já sabe achar o primeiro ponto sólido no caminho
   * (`terreno.raio`); falta só testar as minhocas no meio do caminho, porque
   * a máscara não sabe nada sobre corpos.
   */
  function disparoHitscan(w, arma) {
    const boca = Worm.bocaDaArma(w, 0.4);
    const alcance = arma.alcanceMax ?? 40;

    for (let i = 0; i < (arma.disparos ?? 1); i += 1) {
      const desvio = arma.espalhamento ? rng.range(-arma.espalhamento, arma.espalhamento) : 0;
      const angulo = w.angulo + desvio;
      const destino = {
        x: boca.x + Math.cos(angulo) * w.direcao * alcance,
        y: boca.y + Math.sin(angulo) * alcance,
      };

      const impactoTerreno = terreno.raio(boca.x, boca.y, destino.x, destino.y);
      let melhorT = impactoTerreno ? impactoTerreno.t : 1;
      let alvo = null;

      for (const outra of todas) {
        if (!outra.vivo || outra === w) continue;
        const centro = { x: outra.x, y: outra.y + Worm.ALTURA * 0.5 };
        const t = interseccaoSegmentoCirculo(boca, destino, centro, Worm.LARGURA * 0.65);
        if (t !== null && t < melhorT) {
          melhorT = t;
          alvo = outra;
        }
      }

      const pontoFinal = {
        x: boca.x + (destino.x - boca.x) * melhorT,
        y: boca.y + (destino.y - boca.y) * melhorT,
      };

      estado.tracos.push({ x0: boca.x, y0: boca.y, x1: pontoFinal.x, y1: pontoFinal.y, vida: 0.12 });

      if (alvo) {
        alvo.vida -= arma.dano;
        alvo.piscar = 0.4;
        const dx = alvo.x - w.x || w.direcao;
        Worm.empurrar(alvo, Math.sign(dx) * (arma.impulso ?? 0), (arma.impulso ?? 0) * 0.3);
      }
      if (arma.furoRaio) terreno.explodir(pontoFinal.x, pontoFinal.y, arma.furoRaio);
    }

    sfx.disparo();
  }

  /**
   * A ovelha reaproveita direto as funções de movimento da minhoca: pula com
   * o mesmo impulso, anda com o mesmo degrau, cai com o mesmo dano. Não
   * precisa de física própria — só de um corpo com a forma certa e de um
   * pavio que a IA da minhoca não tem motivo para conhecer.
   */
  function lancarOvelha(w, arma) {
    const carga = Math.max(0.35, estado.carga || 0.6);
    estado.criaturas.push({
      arma,
      dono: w,
      vivo: true,
      x: w.x + w.direcao * 0.4,
      y: w.y + 0.15,
      vx: w.direcao * arma.velocidadeMax * carga,
      vy: 7 * carga,
      estado: 'voando',
      direcao: w.direcao,
      tempoNoAr: 0,
      quedaMaxima: 0,
      restoDoPasso: 0,
      pavio: arma.pavio,
      tempoVivo: 0,
    });
  }

  // ------------------------------------------------------------ update

  function update(dt) {
    estado.tempoAgua += dt;
    if (estado.tempoMensagem > 0) estado.tempoMensagem -= dt;

    // Se o turno acabou (relógio zerou) enquanto a corda estava presa, solta
    // sozinha — senão a minhoca ficaria pendurada para sempre e o turno
    // nunca teria como assentar.
    if (estado.corda && turnos.fase !== FASE.JOGANDO) largarCorda();

    if (estado.corda) {
      estado.corda = Rope.passo(estado.corda, dt, {
        raio: (x0, y0, x1, y1) => terreno.raio(x0, y0, x1, y1),
        comprimentoMin: estado.corda.limiteMin,
        comprimentoMax: estado.corda.limiteMax,
      });
      const w = estado.ativa;
      w.x = estado.corda.x;
      w.y = estado.corda.y;
      w.vx = estado.corda.vx;
      w.vy = estado.corda.vy;
    }

    for (const w of todas) {
      if (w.piscar > 0) w.piscar -= dt;
      const queda = Worm.atualizar(w, terreno, dt, ambiente());
      if (queda) {
        w.vida -= queda.dano;
        w.piscar = 0.4;
        sfx.ai();
      }
      // Passou da linha d'água: some na hora, o resto resolve na fase certa.
      if (w.vivo && w.y < estado.nivelAgua - 0.6) {
        w.vy = Math.max(w.vy, -1.5);
      }
    }

    if (estado.carregando) {
      estado.carga = Math.min(1, estado.carga + dt * 1.35);
      if (estado.carga >= 1) soltar();
    }

    atualizarProjeteis(dt);
    atualizarCriaturas(dt);
    particles.update(dt);

    for (let i = estado.tracos.length - 1; i >= 0; i -= 1) {
      estado.tracos[i].vida -= dt;
      if (estado.tracos[i].vida <= 0) estado.tracos.splice(i, 1);
    }

    // Uma mina armada em outro turno (ou qualquer perigo persistente) pode
    // matar alguém enquanto o jogador da vez ainda não atirou nada — e
    // `resolverConsequencias()` só roda de novo em RESOLVENDO, que só chega
    // depois de um disparo de verdade. Sem isto, essa morte ficaria com
    // vida negativa mas `vivo` ainda true, parada em pé, por até os 45 s
    // inteiros do turno. Só durante JOGANDO: nas outras fases o disparo do
    // próprio jogador já vai levar a uma RESOLVENDO em poucos segundos.
    //
    // E se algo morreu, força o fim do turno na hora — sem isso a morte
    // fica correta (`vivo=false`), mas o jogo só checa vitória/derrota
    // dentro de RESOLVENDO, que nunca é alcançado enquanto ninguém dispara;
    // as duas últimas equipes podiam se eliminar mutuamente e a partida
    // continuar rodando, sem declarar fim, até o relógio do turno zerar.
    if (turnos.fase === FASE.JOGANDO && resolverConsequencias()) {
      turnos.forcarFimDeTurno();
    }

    turnos.update(dt, contexto());
    seguirCamera(dt);

    // Câmera lenta no instante em que um tiro decide a partida.
    estado.slowmo = 1;
    camera.update(dt);
  }

  function atualizarProjeteis(dt) {
    for (let i = estado.projeteis.length - 1; i >= 0; i -= 1) {
      const p = estado.projeteis[i];
      const antes = Math.hypot(p.vx, p.vy);
      const r = atualizarProjetil(p, terreno, dt, ambiente());

      // A mina não explode ao tocar — só quando algo vivo chega perto, e só
      // depois do atraso de armar (senão explode em quem acabou de largá-la).
      let explodiu = r === 'explodir';
      if (!explodiu && p.arma.proximidade && p.tempoVivo > (p.arma.atraso ?? 0)) {
        for (const w of todas) {
          if (!w.vivo) continue;
          if (Math.hypot(w.x - p.x, w.y - p.y) < p.arma.proximidade) {
            explodiu = true;
            break;
          }
        }
      }

      // Quem "explode ao encostar em qualquer coisa" (bazuca, morteiro,
      // míssil) só testava contato com o TERRENO — uma minhoca no ar não é
      // terreno, e sem gravidade o míssil atravessaria um alvo elevado para
      // sempre. Aqui o corpo de uma minhoca também conta como "qualquer coisa".
      if (!explodiu && !p.arma.pavio && !p.arma.assentaSemExplodir) {
        for (const w of todas) {
          if (!w.vivo || w === p.dono) continue;
          const centro = { x: w.x, y: w.y + Worm.ALTURA * 0.5 };
          if (Math.hypot(p.x - centro.x, p.y - centro.y) < Worm.LARGURA * 0.6) {
            explodiu = true;
            break;
          }
        }
      }

      // Rastro de fumaça do foguete (e do míssil guiado, que usa o mesmo desenho).
      p.fumaca -= dt;
      const ehFoguete = p.arma.tipo === 'projetil' || (p.arma.tipo === 'dirigivel' && p.arma.modo === 'reto');
      if (ehFoguete && p.fumaca <= 0) {
        p.fumaca = 0.02;
        particles.spawn({
          x: p.x,
          y: p.y,
          vx: rng.range(-0.3, 0.3),
          vy: rng.range(0, 0.6),
          life: rng.range(0.4, 0.9),
          size: rng.range(0.08, 0.2),
          color: 'rgba(220, 220, 220, 0.5)',
          gravity: -0.8,
          drag: 1.8,
        });
      }
      if (antes > 2 && Math.hypot(p.vx, p.vy) < antes * 0.7 && p.arma.pavio) sfx.quique();

      // Caiu na água: apaga sem explodir.
      if (p.y < estado.nivelAgua) {
        respingar(p.x, estado.nivelAgua);
        sfx.respingo();
        estado.projeteis.splice(i, 1);
        continue;
      }

      // A viga não explode nem espera gatilho: assentou, vira terreno.
      if (p.arma.construir && p.apoiado) {
        const { largura, altura } = p.arma.construir;
        terreno.construir(p.x, p.y, largura, altura);
        camera.addShake(0.12);
        sfx.quique();
        estado.projeteis.splice(i, 1);
        continue;
      }

      if (explodiu) {
        detonar(p.x, p.y, p.arma);
        estado.projeteis.splice(i, 1);
      }
    }
  }

  /**
   * A ovelha: mesma física de chão da minhoca (Worm.atualizar/andar), sem
   * jogador nenhum segurando a tecla — anda sozinha até o pavio acabar ou
   * até chegar perto de alguém vivo.
   */
  function atualizarCriaturas(dt) {
    for (let i = estado.criaturas.length - 1; i >= 0; i -= 1) {
      const c = estado.criaturas[i];
      Worm.atualizar(c, terreno, dt, ambiente());
      if (c.estado !== 'voando') Worm.andar(c, terreno, c.direcao, dt);

      c.tempoVivo = (c.tempoVivo ?? 0) + dt;
      c.pavio -= dt;

      let explodiu = c.pavio <= 0;
      if (!explodiu && c.arma.proximidade && c.tempoVivo > 0.5) {
        for (const w of todas) {
          if (!w.vivo) continue;
          if (Math.hypot(w.x - c.x, w.y - (c.y + Worm.ALTURA * 0.5)) < c.arma.proximidade) {
            explodiu = true;
            break;
          }
        }
      }

      if (c.y < estado.nivelAgua) {
        respingar(c.x, estado.nivelAgua);
        sfx.respingo();
        estado.criaturas.splice(i, 1);
        continue;
      }
      if (explodiu) {
        detonar(c.x, c.y + Worm.ALTURA * 0.3, c.arma);
        estado.criaturas.splice(i, 1);
      }
    }
  }

  function seguirCamera(dt) {
    if (estado.criaturas.length > 0) {
      const alvo = estado.criaturas[0];
      camera.lookAt(alvo.x, alvo.y + 1, 22 * estado.zoom);
      return;
    }
    // Uma mina já assentada não puxa mais a câmera: ela fica no mapa como
    // uma armadilha silenciosa, e o jogo segue acompanhando quem está jogando.
    const emVoo = estado.projeteis.filter(bloqueiaTurno);
    if (emVoo.length > 0) {
      // Segue o projétil mais alto — é o que o jogador está acompanhando.
      const alvo = emVoo.reduce((a, b) => (b.y > a.y ? b : a));
      camera.lookAt(alvo.x, alvo.y, 24 * estado.zoom);
      return;
    }
    if (estado.ativa?.vivo) {
      camera.lookAt(estado.ativa.x, estado.ativa.y + 1.2, 26 * estado.zoom);
    }
  }

  // ------------------------------------------------------------ desenho

  function desenhar(ctx) {
    desenharCeu(ctx);
    terreno.repintar(2);
    terreno.desenhar(ctx, camera);
    desenharAgua(ctx);

    for (const time of times) {
      for (const w of time.minhocas) {
        Worm.desenharMinhoca(ctx, w, camera, {
          ativa: w === estado.ativa && turnos.podeControlar,
          cores: time.cores,
        });
      }
    }

    for (const c of estado.criaturas) desenharOvelha(ctx, c, camera);

    if (estado.corda) desenharCorda(ctx);
    else if (podeAgir() && estado.ativa) desenharMira(ctx);

    particles.draw(ctx, camera);

    for (const p of estado.projeteis) desenharProjetil(ctx, p, camera);
    for (const t of estado.tracos) desenharTraco(ctx, t, camera);
  }

  /** A ovelha: uma minhoca branca e felpuda, sem arma nem barra de vida. */
  function desenharOvelha(ctx, c, camera) {
    const p = camera.toScreen(c.x, c.y);
    const e = camera.scale;
    const r = e * Worm.LARGURA * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * 1.1, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f4f1e8';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - r * 1.1, r * 1.15, r * 1.0, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.ellipse(p.x + c.direcao * r * 0.9, p.y - r * 1.05, r * 0.45, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // O pavio piscando avisa quanto tempo falta.
    const aceso = Math.floor(Date.now() / (c.pavio < 1.5 ? 100 : 300)) % 2 === 0;
    ctx.fillStyle = aceso ? '#ff5e4d' : '#7a3830';
    ctx.beginPath();
    ctx.arc(p.x, p.y - r * 2, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** O traço luminoso de um tiro instantâneo, sumindo em poucos quadros. */
  function desenharTraco(ctx, t, camera) {
    const a = camera.toScreen(t.x0, t.y0);
    const b = camera.toScreen(t.x1, t.y1);
    ctx.save();
    ctx.globalAlpha = Math.max(0, t.vida / 0.12);
    ctx.strokeStyle = '#fff6c9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function desenharCeu(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, camera.height);
    g.addColorStop(0, '#1d3c63');
    g.addColorStop(0.55, '#4d7ea8');
    g.addColorStop(1, '#9dbfc9');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, camera.width, camera.height);

    // Nuvens em parallax: cada uma é um punhado de bolhas sobrepostas, porque
    // uma elipse sozinha lê como mancha de interface, não como nuvem.
    for (let i = 0; i < 10; i += 1) {
      const base = (i * 31.7) % terreno.largura;
      const camadaY = terreno.altura * (0.74 + (i % 3) * 0.08);
      const fator = 0.2 + (i % 3) * 0.14;   // camadas mais distantes andam menos
      const x = base - camera.x * fator + camera.x;
      const centro = camera.toScreen(x, camadaY);
      if (centro.x < -300 || centro.x > camera.width + 300) continue;

      const escala = camera.scale * (1.1 + (i % 4) * 0.3);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + (i % 3) * 0.035})`;
      ctx.beginPath();
      for (const [dx, dy, r] of BOLHAS_DE_NUVEM) {
        ctx.ellipse(centro.x + dx * escala, centro.y + dy * escala, r * escala, r * escala * 0.62, 0, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  function desenharAgua(ctx) {
    const topo = camera.toScreen(0, estado.nivelAgua).y;
    if (topo > camera.height) return;

    const g = ctx.createLinearGradient(0, topo, 0, camera.height);
    g.addColorStop(0, 'rgba(64, 150, 196, 0.62)');
    g.addColorStop(1, 'rgba(16, 52, 92, 0.92)');
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(0, camera.height);
    ctx.lineTo(0, topo);
    // Duas senoides somadas dão uma ondulação que não parece um metrônomo.
    for (let x = 0; x <= camera.width; x += 8) {
      const onda =
        Math.sin(x * 0.018 + estado.tempoAgua * 1.6) * 3 +
        Math.sin(x * 0.007 - estado.tempoAgua * 0.9) * 5;
      ctx.lineTo(x, topo + onda);
    }
    ctx.lineTo(camera.width, camera.height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(226, 245, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= camera.width; x += 8) {
      const onda =
        Math.sin(x * 0.018 + estado.tempoAgua * 1.6) * 3 +
        Math.sin(x * 0.007 - estado.tempoAgua * 0.9) * 5;
      if (x === 0) ctx.moveTo(x, topo + onda);
      else ctx.lineTo(x, topo + onda);
    }
    ctx.stroke();
  }

  /** A corda: uma linha por cima de cada pivô empilhado, até a minhoca. */
  function desenharCorda(ctx) {
    const c = estado.corda;
    const w = estado.ativa;
    if (!c || !w) return;

    ctx.save();
    ctx.strokeStyle = '#e8d9a0';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const primeiro = camera.toScreen(c.pivos[0].x, c.pivos[0].y);
    ctx.moveTo(primeiro.x, primeiro.y);
    for (let i = 1; i < c.pivos.length; i += 1) {
      const p = camera.toScreen(c.pivos[i].x, c.pivos[i].y);
      ctx.lineTo(p.x, p.y);
    }
    const ponta = camera.toScreen(w.x, w.y + Worm.ALTURA * 0.5);
    ctx.lineTo(ponta.x, ponta.y);
    ctx.stroke();

    // Um pino em cada pivô, para ficar claro onde a corda pegou.
    ctx.fillStyle = '#e8d9a0';
    for (const p of c.pivos) {
      const s = camera.toScreen(p.x, p.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Mira: uma cruz na direção apontada e a barra de força carregando.
   * De propósito NÃO existe linha de trajetória — adivinhar o arco é o jogo.
   */
  function desenharMira(ctx) {
    const w = estado.ativa;
    if (!estado.arma.miravel) return;

    const boca = Worm.bocaDaArma(w, 0);
    const alcance = 2.6;
    const alvoX = boca.x + Math.cos(w.angulo) * w.direcao * alcance;
    const alvoY = boca.y + Math.sin(w.angulo) * alcance;
    const origem = camera.toScreen(boca.x, boca.y);
    const ponta = camera.toScreen(alvoX, alvoY);

    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(origem.x, origem.y);
    ctx.lineTo(ponta.x, ponta.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ponta.x, ponta.y, 7, 0, Math.PI * 2);
    ctx.moveTo(ponta.x - 11, ponta.y);
    ctx.lineTo(ponta.x - 3, ponta.y);
    ctx.moveTo(ponta.x + 3, ponta.y);
    ctx.lineTo(ponta.x + 11, ponta.y);
    ctx.stroke();

    if (estado.carregando) {
      const largura = camera.scale * 1.8;
      const altura = 7;
      const x = origem.x - largura / 2;
      const y = camera.toScreen(w.x, w.y + Worm.ALTURA + 1.4).y;
      ctx.fillStyle = 'rgba(9, 16, 26, 0.6)';
      ctx.fillRect(x - 1, y - 1, largura + 2, altura + 2);
      const cor = estado.carga < 0.45 ? '#7bc65f' : estado.carga < 0.8 ? '#ffd24a' : '#e2453c';
      ctx.fillStyle = cor;
      ctx.fillRect(x, y, largura * estado.carga, altura);
    }

    ctx.restore();
  }

  return {
    estado,
    turnos,
    terreno,
    comandos,
    times,
    todas,
    // Exposto para `ai.js`: os adversários de IA usam a mesma semente, então
    // uma partida com semente fixa joga sempre a mesma partida, IA incluída.
    rng,
    update,
    desenhar,
    get FASE() {
      return FASE;
    },
    get fase() {
      return turnos.fase;
    },
    get relogio() {
      return turnos.relogio;
    },
    get fimDeJogo() {
      return estado.fimDeJogo;
    },
  };
}

/**
 * Escolhe pontos de nascimento espalhados: pega o candidato mais distante de
 * todos os já escolhidos, para nenhuma equipe começar encurralada num canto.
 */
function escolherNascimentos(candidatos, quantos, rng) {
  if (candidatos.length === 0) return [];
  const restantes = [...candidatos];
  const escolhidos = [restantes.splice(rng.int(0, restantes.length), 1)[0]];

  while (escolhidos.length < quantos && restantes.length > 0) {
    let melhor = 0;
    let melhorDistancia = -1;
    for (let i = 0; i < restantes.length; i += 1) {
      let perto = Infinity;
      for (const e of escolhidos) {
        perto = Math.min(perto, Math.abs(restantes[i].x - e.x));
      }
      if (perto > melhorDistancia) {
        melhorDistancia = perto;
        melhor = i;
      }
    }
    escolhidos.push(restantes.splice(melhor, 1)[0]);
  }

  // Alterna a ordem para as equipes ficarem intercaladas no mapa.
  return rng.shuffle(escolhidos);
}
