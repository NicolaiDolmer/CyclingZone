// #6570 · Tekst til loebshistoriens linjer: kun ord om det linjen baerer
// (antal, navne, km, huller fra loggen). Copy: races.json stagePageV2.story.*
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import { formatClock, kmValue, namesList, type Cast, type StoryLine } from "./raceStoryModel.ts";

/** Linjer hvor dine ryttere allerede staar i selve teksten (kun et YOU-maerke). */
const NAMED_KINDS = new Set(["attack", "incident", "climb", "gcLead", "crack", "finish"]);

export function useStoryText(cast: Cast) {
  const { t } = useTranslation("races");
  const km = (v: number) => formatNumber(kmValue(v), { maximumFractionDigits: 1 });

  function kmLabel(line: StoryLine): string {
    if (line.kmTo != null && Math.round(line.kmTo * 10) !== Math.round(line.km * 10)) {
      return t("stagePageV2.story.kmSpan", { from: km(line.km), to: km(line.kmTo) });
    }
    return t("stagePageV2.story.kmAt", { km: km(line.km) });
  }

  function lineText(line: StoryLine): string {
    const names = namesList(line.riderIds, cast, 2);
    const name = names || t("stagePageV2.story.aRider");
    const d = line.data;
    switch (line.kind) {
      case "formed": return t(d.ahead ? "stagePageV2.story.line.formedAhead" : "stagePageV2.story.line.formed", { count: line.count }); // #6299
      case "caught": return t(d.ahead ? "stagePageV2.story.line.caughtAhead" : "stagePageV2.story.line.caught", { count: Number(d.riders ?? line.count) });
      case "survived": return t(d.ahead ? "stagePageV2.story.line.survivedAhead" : "stagePageV2.story.line.survived");
      case "attack": {
        const gain = typeof d.gain === "number" && d.gain >= 1 ? formatClock(d.gain) : null;
        if (!names) return t("stagePageV2.story.line.attackAnon");
        const count = Math.max(1, line.riderIds.length);
        return gain ? t("stagePageV2.story.line.attackGain", { names, gain, count }) : t("stagePageV2.story.line.attack", { names, count });
      }
      case "incident": {
        const outcome = d.outcome === "abandoned" ? "abandoned" : typeof d.loss === "number" && d.loss >= 1 ? "loss" : "plain";
        return t("stagePageV2.story.line.incident", {
          name,
          kind: d.incident === "crash" || d.incident === "mechanical" ? d.incident : "other",
          outcome,
          loss: typeof d.loss === "number" ? formatClock(d.loss) : "",
        });
      }
      case "climb":
        return names
          ? t("stagePageV2.story.line.climbFirst", { rider: names, name: String(d.name ?? "") })
          : t("stagePageV2.story.line.climb", { name: String(d.name ?? "") });
      case "gap":
        return t("stagePageV2.story.line.gap", {
          group: d.group === "rest" ? "rest" : "chase",
          dir: d.dir === "grew" ? "grew" : "shrank",
          before: formatClock(Number(d.before)),
          after: formatClock(Number(d.after)),
        });
      case "split": return t("stagePageV2.story.line.split", { count: line.count });
      case "dropped": return t(d.ahead ? "stagePageV2.story.line.droppedAhead" : "stagePageV2.story.line.dropped", { count: line.riderIds.length, names: name });
      case "joined": return t("stagePageV2.story.line.joined", { count: line.count });
      case "gcLead": return t("stagePageV2.story.line.gcLead", { name });
      case "crack": return t("stagePageV2.story.line.crack", { name });
      case "finish":
        if (!names) return t("stagePageV2.story.line.finishAnon");
        return d.sprint ? t("stagePageV2.story.line.finishSprint", { name: names }) : t("stagePageV2.story.line.finish", { name: names });
      default: return "";
    }
  }

  /** Dine ryttere i linjen, naar teksten ikke allerede naevner dem. */
  function mineNote(line: StoryLine): string | null {
    if (!line.mineIds.length) return null;
    if (NAMED_KINDS.has(line.kind)) return "";
    return namesList(line.mineIds, cast, 3);
  }

  return { kmLabel, lineText, mineNote, km };
}
