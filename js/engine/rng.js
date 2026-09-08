/**
 * Gerador de números pseudoaleatórios determinístico (mulberry32).
 *
 * A regra do projeto: `Math.random()` é proibido em código de jogo. Tudo que
 * afeta a partida — mapa, vento, sorteios — passa por aqui. É isso que torna
 * a mesma semente sempre a mesma partida, e que deixa os testes reprodutíveis.
 */

/** Converte um texto em semente de 32 bits (FNV-1a). */
export function hashSeed(text) {
  let hash = 0x811c9dc5;
  const str = String(text);
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Semente aleatória para uma partida nova — o único ponto com acaso real. */
export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

/**
 * @param {number|string} seed
 */
export function createRng(seed) {
  const initial = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  let state = initial;

  /** Próximo float em [0, 1). */
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    /** Float em [min, max). */
    range: (min, max) => min + next() * (max - min),
    /** Inteiro em [min, max). */
    int: (min, max) => Math.floor(min + next() * (max - min)),
    /** -1 ou 1. */
    sign: () => (next() < 0.5 ? -1 : 1),
    /** Um item qualquer da lista. */
    pick: (list) => list[Math.floor(next() * list.length)],
    /** Embaralha no lugar (Fisher-Yates). */
    shuffle(list) {
      for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    },
    /** A semente original, para mostrar e para repetir a partida. */
    get seed() {
      return initial;
    },
    /** Estado atual, para gravar e retomar no meio (replays). */
    get state() {
      return state;
    },
    set state(value) {
      state = value >>> 0;
    },
  };
}
