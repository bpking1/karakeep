import type { WordInfo } from "./types";

// Owned by one connection's client. It holds dictionary responses only, never
// selections, article text, credentials, AI calls or queued writes.
export class WordLookupCache {
  private values = new Map<string, { value: WordInfo; expires: number }>();
  private pending = new Map<string, Promise<Map<string, WordInfo>>>();
  private generation = 0;

  constructor(
    private readonly ttl = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  invalidate() {
    this.generation++;
    this.values.clear();
    this.pending.clear();
  }

  async lookup(
    words: string[],
    read: (words: string[]) => Promise<WordInfo[]>,
  ): Promise<WordInfo[]> {
    const now = this.now();
    for (const [word, cached] of this.values) {
      if (cached.expires <= now) this.values.delete(word);
    }
    const missing = [...new Set(words)].filter(
      (word) => !this.values.has(word) && !this.pending.has(word),
    );
    if (missing.length) {
      const generation = this.generation;
      const batch = read(missing)
        .then((items) => {
          const indexed = new Map(items.map((item) => [item.input, item]));
          if (missing.some((word) => !indexed.has(word))) {
            throw new Error("词汇查询结果不完整，请手动重试");
          }
          if (generation === this.generation) {
            for (const word of missing) {
              this.values.set(word, {
                value: indexed.get(word)!,
                expires: this.now() + this.ttl,
              });
            }
            while (this.values.size > 5000) {
              this.values.delete(this.values.keys().next().value!);
            }
          }
          return indexed;
        })
        .finally(() => {
          for (const word of missing) {
            if (this.pending.get(word) === batch) this.pending.delete(word);
          }
        });
      for (const word of missing) this.pending.set(word, batch);
    }
    return Promise.all(
      words.map(async (word) => {
        const cached = this.values.get(word);
        if (cached) return cached.value;
        const result = await this.pending.get(word)!;
        return result.get(word)!;
      }),
    );
  }
}
