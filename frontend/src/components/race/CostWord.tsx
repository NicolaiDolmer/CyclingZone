// #7638: the one price word (Easy / Medium / Hard / Very hard) every order shows after its
// name, in the same colour everywhere: the stage plan's tasks, the effort picker, the
// team's breakaway stance and the old order buttons. Words, never numbers.
import { COST_WORD_CLASS, costWordKey, type TaskCostWord } from "./tacticsReady7864.ts";

type TFn = { (key: string): string; (key: string, opts: Record<string, unknown>): string };

export default function CostWord({ t, word, className = "", testId = "cost-word" }: { t: TFn; word: TaskCostWord | null | undefined; className?: string; testId?: string }) {
  if (!word) return null;
  return (
    <span className={`font-semibold normal-case tracking-normal ${COST_WORD_CLASS[word]} ${className}`} data-price={word} data-testid={testId}>
      {t(costWordKey(word))}
    </span>
  );
}
