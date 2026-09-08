/**
 * Telas de interface: menu, pausa e fim de partida.
 *
 * São elementos do DOM sobre o canvas, e não desenho no canvas: assim os
 * botões são navegáveis por Tab e lidos por leitor de tela de graça.
 */

import { save } from '../../engine/storage.js';
import { sfx } from '../../engine/audio.js';
import { coresDaEquipe, NOMES_EQUIPE } from '../worm.js';

export function createScreens(root, actions) {
  let current = null;
  const config = {
    equipes: 2,
    minhocas: 4,
    tempoTurno: 45,
    semente: '',
    // Um valor por equipe (só os `equipes` primeiros contam). Time 1 humano
    // por padrão — ninguém abre o jogo e some sem escolher nada — o resto
    // como adversário de IA, porque "jogar contra si mesmo" não é o pedido
    // comum de quem abre o menu sozinho.
    controladores: ['humano', 'ia', 'ia', 'ia'],
  };

  function clear() {
    root.innerHTML = '';
    root.hidden = true;
    current = null;
  }

  function panel(title, subtitle) {
    root.innerHTML = '';
    root.hidden = false;
    const box = el('div', 'panel');
    if (title) box.append(el('h1', 'panel-title', title));
    if (subtitle) box.append(el('p', 'panel-subtitle', subtitle));
    root.append(box);
    return box;
  }

  function button(label, onClick, variant = '') {
    const btn = el('button', `btn ${variant}`.trim(), label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      sfx.click();
      onClick();
    });
    return btn;
  }

  const screens = {
    get current() {
      return current;
    },

    get config() {
      return config;
    },

    hide: clear,

    menu() {
      current = 'menu';
      const box = panel('Minhocas', 'Artilharia por turnos. Uma equipe sai viva.');

      box.append(
        seletor('Equipes', [2, 3, 4], config.equipes, (v) => {
          config.equipes = v;
          screens.menu(); // o número de linhas de "Quem joga" abaixo depende disto
        }),
        seletor('Minhocas por equipe', [2, 3, 4, 6], config.minhocas, (v) => {
          config.minhocas = v;
        }),
        seletor('Tempo de turno', [30, 45, 60], config.tempoTurno, (v) => {
          config.tempoTurno = v;
        }, (v) => `${v}s`),
      );

      box.append(controladores(config));

      const campo = el('div', 'campo');
      const rotulo = el('label', 'campo-rotulo', 'Semente do mapa (opcional)');
      const entrada = document.createElement('input');
      entrada.type = 'text';
      entrada.className = 'campo-entrada';
      entrada.placeholder = 'deixe em branco para sortear';
      entrada.value = config.semente;
      entrada.id = 'semente';
      rotulo.htmlFor = 'semente';
      entrada.addEventListener('input', () => {
        config.semente = entrada.value.trim();
      });
      campo.append(rotulo, entrada);
      box.append(campo);

      const linha = el('div', 'actions');
      linha.append(
        button('Jogar', () => actions.jogar(config), 'primary'),
        button('Como se joga', () => screens.ajuda()),
      );
      box.append(linha);

      const ajustes = el('div', 'actions secondary-actions');
      ajustes.append(
        toggle('Som', save.settings.sound, (value) => {
          save.setSetting('sound', value);
          sfx.setEnabled(value);
        }),
        toggle('Efeitos de câmera', save.settings.motion, (value) => {
          save.setSetting('motion', value);
          actions.setMotion(value);
        }),
      );
      box.append(ajustes);
    },

    ajuda() {
      current = 'ajuda';

      // Ensinar a tecla a quem está no dedo (ou o contrário) é pior que não
      // ensinar nada: a tabela segue o mesmo jeito de jogar que os botões da
      // tela seguem.
      const toque = actions.usandoToque?.() === true;

      const box = panel(
        'Como se joga',
        toque
          ? 'Dois jogadores no mesmo aparelho, um turno de cada vez.'
          : 'Dois jogadores no mesmo teclado, um turno de cada vez.',
      );

      box.append(tabela(toque ? [
        ['Andar', '◀ ▶'],
        ['Mirar', '▲ ▼, ou arraste no campo'],
        ['Ajuste fino da mira', 'arraste longe da minhoca'],
        ['Força do tiro', 'segure FOGO e solte'],
        ['Pular', '↷'],
        ['Cambalhota para trás', '↺'],
        ['Trocar de arma', 'o botão com o nome da arma'],
        ['Pavio da granada', '1 a 5, na folha do arsenal'],
        ['Corda ninja', 'FOGO prende e solta · ▲ ▼ encolhem/alongam'],
        ['Jetpack', 'segure FOGO para subir · ◀ ▶ de lado'],
        ['Teleporte', 'FOGO aparece onde a mira aponta'],
        ['Pausar', 'o botão ⏸ no canto'],
      ] : [
        ['Andar', '← →'],
        ['Mirar', '↑ ↓, ou arraste no campo'],
        ['Ajuste fino da mira', 'Shift + ↑ ↓'],
        ['Força do tiro', 'segure Espaço e solte'],
        ['Pular', 'Enter'],
        ['Cambalhota para trás', 'Backspace'],
        ['Trocar de arma', '[ e ] percorrem o arsenal'],
        ['Pavio da granada', '1 a 5, com uma granada na mão'],
        ['Corda ninja', 'Espaço prende e solta · ↑ ↓ encolhem/alongam'],
        ['Jetpack', 'segure Espaço para subir · ← → de lado'],
        ['Teleporte', 'Espaço aparece onde a mira aponta'],
        ['Pausar', 'P'],
      ]));

      box.append(el('p', 'hint-text',
        'Cada turno dura o tempo escolhido. Depois do tiro sobram 3 segundos '
        + 'para correr. O vento entorta a bazuca, mas não a granada. Cair de '
        + 'muito alto machuca, e a água mata na hora. Depois de 10 rodadas a '
        + 'água começa a subir.'));

      box.append(el('div', 'actions').also((r) => r.append(button('Voltar', () => screens.menu()))));
    },

    pause() {
      current = 'pause';
      const box = panel('Pausa');
      const row = el('div', 'actions');
      row.append(
        button('Continuar', () => actions.resume(), 'primary'),
        button('Nova partida', () => actions.toMenu()),
      );
      box.append(row);
    },

    /** @param {{vencedor:object|null, semente:number, times:Array, turnos:number}} data */
    fim(data) {
      current = 'fim';
      const box = panel(
        data.vencedor ? `${data.vencedor.nome} venceram` : 'Empate',
        data.vencedor ? 'Última equipe em pé.' : 'Ninguém sobrou no campo.',
      );

      const placar = el('div', 'placar');
      for (const time of data.times) {
        const vivas = time.minhocas.filter((w) => w.vivo).length;
        const linha = el('div', 'placar-linha');
        const pino = el('span', 'placar-cor');
        pino.style.background = time.cores.corpo;
        linha.append(
          pino,
          el('span', 'placar-nome', time.nome),
          el('span', 'placar-valor', `${vivas} de ${time.minhocas.length} viva(s)`),
        );
        placar.append(linha);
      }
      box.append(placar);

      const turnos = data.turnos + 1;
      box.append(el('p', 'stats',
        `${turnos} ${turnos === 1 ? 'turno jogado' : 'turnos jogados'} · semente ${data.semente}`));

      const row = el('div', 'actions');
      row.append(
        button('Jogar de novo', () => actions.repetir(), 'primary'),
        button('Novo mapa', () => actions.jogar({ ...config, semente: '' })),
        button('Menu', () => actions.toMenu()),
      );
      box.append(row);
    },

    carregando() {
      current = 'carregando';
      panel('Cavando o mapa…', 'Gerando o terreno a partir da semente.');
    },
  };

  return screens;
}

function tabela(linhas) {
  const wrap = el('div', 'tabela');
  for (const [acao, tecla] of linhas) {
    const linha = el('div', 'tabela-linha');
    linha.append(el('span', 'tabela-acao', acao), el('span', 'tabela-tecla', tecla));
    wrap.append(linha);
  }
  return wrap;
}

function seletor(rotulo, opcoes, valor, onChange, formatar = String) {
  const wrap = el('div', 'seletor');
  wrap.append(el('span', 'seletor-rotulo', rotulo));
  const grupo = el('div', 'seletor-opcoes');
  grupo.setAttribute('role', 'group');
  grupo.setAttribute('aria-label', rotulo);

  const botoes = opcoes.map((opcao) => {
    const b = el('button', 'seletor-opcao', formatar(opcao));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(opcao === valor));
    if (opcao === valor) b.classList.add('ativo');
    b.addEventListener('click', () => {
      sfx.click();
      onChange(opcao);
      for (const outro of botoes) {
        const ativo = outro === b;
        outro.classList.toggle('ativo', ativo);
        outro.setAttribute('aria-pressed', String(ativo));
      }
    });
    return b;
  });

  grupo.append(...botoes);
  wrap.append(grupo);
  return wrap;
}

/**
 * Uma linha "Humano/IA" por equipe — reaproveita `seletor()` (mesmo par de
 * botões usado em "Equipes" e "Tempo de turno") e só decora o rótulo com a
 * cor do time, pra ficar claro qual linha é qual antes mesmo de ler o nome.
 */
function controladores(config) {
  const wrap = el('div', 'controladores');
  wrap.append(el('span', 'seletor-rotulo', 'Quem joga'));

  for (let i = 0; i < config.equipes; i += 1) {
    const linha = seletor(
      NOMES_EQUIPE[i],
      ['humano', 'ia'],
      config.controladores[i],
      (v) => { config.controladores[i] = v; },
      (v) => (v === 'ia' ? 'IA' : 'Você'),
    );
    const rotulo = linha.querySelector('.seletor-rotulo');
    const bolinha = el('span', 'controlador-cor');
    bolinha.style.background = coresDaEquipe(i).corpo;
    rotulo.prepend(bolinha);
    wrap.append(linha);
  }

  return wrap;
}

function toggle(label, initial, onChange) {
  const wrapper = el('label', 'toggle');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initial;
  input.addEventListener('change', () => onChange(input.checked));
  wrapper.append(input, el('span', '', label));
  return wrapper;
}

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  node.also = (fn) => {
    fn(node);
    return node;
  };
  return node;
}
