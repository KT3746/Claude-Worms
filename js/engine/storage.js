/**
 * Progresso salvo. O localStorage pode lançar (janela anônima, cookies
 * bloqueados, cota cheia), então tudo é protegido e cai para memória.
 */

const KEY = 'arqueiro.save.v1';

const empty = () => ({ levels: {}, settings: { sound: true, motion: true } });

let memory = empty();

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    return {
      levels: parsed?.levels && typeof parsed.levels === 'object' ? parsed.levels : {},
      settings: { ...empty().settings, ...(parsed?.settings ?? {}) },
    };
  } catch {
    return { ...memory };
  }
}

function write(data) {
  memory = data;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* segue só em memória */
  }
}

export const save = {
  load() {
    memory = read();
    return memory;
  },

  /** Melhor resultado de um nível: {stars, score}. */
  levelResult(id) {
    return memory.levels[id] ?? { stars: 0, score: 0 };
  },

  /** Registra um resultado, mantendo sempre o melhor. */
  recordLevel(id, { stars, score }) {
    const previous = this.levelResult(id);
    const merged = {
      stars: Math.max(previous.stars, stars),
      score: Math.max(previous.score, score),
    };
    const improved = merged.stars > previous.stars || merged.score > previous.score;
    memory.levels[id] = merged;
    write(memory);
    return { ...merged, improved };
  },

  /** Um nível está destravado? O primeiro sempre está. */
  isUnlocked(index, levels) {
    if (index <= 0) return true;
    return this.levelResult(levels[index - 1].id).stars > 0;
  },

  totalStars() {
    return Object.values(memory.levels).reduce((sum, l) => sum + (l.stars ?? 0), 0);
  },

  get settings() {
    return memory.settings;
  },

  setSetting(key, value) {
    memory.settings[key] = value;
    write(memory);
  },

  reset() {
    write(empty());
  },
};
