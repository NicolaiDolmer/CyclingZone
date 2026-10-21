// #6993 · Etapens vejr: stroke-ikon + ét ord. Regler for hvornår: stageWeather.ts.
import { useTranslation } from "react-i18next";
import type { StageWeather, WeatherWord } from "./stageWeather.ts";

function WeatherIcon({ word }: { word: WeatherWord }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} className="block flex-none" aria-hidden="true">
      {word === "dry" && (
        <g {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </g>
      )}
      {word === "rain" && (
        <g {...common}>
          <path d="M7 15.5a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6 1.5 3.3 3.3 0 0 1 .3 6.5Z" />
          <path d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5" />
        </g>
      )}
      {word === "wind" && (
        <g {...common}>
          <path d="M3 9h11a3 3 0 1 0-3-3" />
          <path d="M3 13h15a3 3 0 1 1-3 3" />
          <path d="M3 17h7" />
        </g>
      )}
    </svg>
  );
}

/** Ikon + ord; skærmlæseren får "Weather: Rain". */
export function WeatherTag({ weather, className = "" }: { weather: StageWeather; className?: string }) {
  const { t } = useTranslation("races");
  const word = t(`stagePageV2.weather.${weather.word}`);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} aria-label={t("stagePageV2.weather.aria", { word })} role="img">
      <WeatherIcon word={weather.word} />
      <span aria-hidden="true">{word}</span>
    </span>
  );
}

/** Én sætning, kun når motoren selv loggede at vejret kostede kraft. */
export function weatherSentenceKey(weather: StageWeather | null): string | null {
  if (!weather?.mattered || weather.word === "dry") return null;
  return `stagePageV2.weather.mattered.${weather.word}`;
}
