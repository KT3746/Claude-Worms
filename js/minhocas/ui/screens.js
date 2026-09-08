/**
 * Telas de interface: menu, pausa e fim de partida.
 *
 * São elementos do DOM sobre o canvas, e não desenho no canvas: assim os
 * botões são navegáveis por Tab e lidos por leitor de tela de graça.
 */

import { save } from '../../engine/storage.js';
import { sfx } from '../../engine/audio.js';

export function createScreens(root, actions) {
  let current = null;
  const config = {
    equipes: 2,
    minhocas: 4,
    tempoTurno: 45,
    semente: '',
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
        }),
        seletor('Minhocas por equipe', [2, 3, 4, 6], config.minhocas, (v) => {
          config.minhocas = v;
        }),
        seletor('Tempo de turno', [30, 45, 60], config.tempoTurno, (v) => {
          config.tempoTurno = v;
        }, (v) => `${v}s`),
      );

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
      const box = panel('Como se joga', 'Dois jogadores no mesmo teclado, um turno de cada vez.');

      box.append(tabela([
        ['Andar', '← →'],
        ['Mirar', '↑ ↓'],
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
