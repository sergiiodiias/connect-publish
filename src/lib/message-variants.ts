// Utilidades de rotação de texto para reduzir detecção de duplicidade pelo Facebook.
//
// - expandSpintax: expande padrões {a|b|c} de forma determinística com base num seed.
// - rotateMessage: quando a mensagem já tem spintax, expande; caso contrário, aplica
//   uma variação leve (sufixo com emoji ou zero-width) rotacionando por bloco.

const FALLBACK_SUFFIXES = [
  "",
  " ✨",
  " 🔥",
  " 💫",
  " ⭐",
  " 🎯",
  " 💯",
  " 🚀",
  " 👀",
  " 🙌",
];

export function expandSpintax(msg: string, seed = 0): string {
  if (!msg) return msg;
  let out = msg;
  const re = /\{([^{}]+)\}/;
  let guard = 0;
  let s = Math.max(0, Math.floor(seed));
  while (re.test(out) && guard++ < 100) {
    out = out.replace(re, (_m, opts: string) => {
      const arr = opts.split("|");
      const pick = arr[s % arr.length] ?? arr[0];
      s = Math.floor(s / arr.length) + 1;
      return pick;
    });
  }
  return out;
}

export function hasSpintax(msg: string | null | undefined): boolean {
  return !!msg && /\{[^{}]+\|[^{}]+\}/.test(msg);
}

export function rotateMessage(msg: string, blockIndex: number): string {
  if (!msg) return msg;
  if (hasSpintax(msg)) return expandSpintax(msg, blockIndex);
  const suffix = FALLBACK_SUFFIXES[blockIndex % FALLBACK_SUFFIXES.length];
  return suffix ? `${msg}${suffix}` : msg;
}
