import { FOOTER, type Lang } from "@/lib/copy";

export default function SiteFooter({ lang }: { lang: Lang }) {
  const t = FOOTER[lang];
  return (
    <footer className="site-footer">
      <nav aria-label={lang === "da" ? "Sidefod" : "Footer"}>
        {t.links.map((l) => (
          <a key={l.href} href={l.href}>
            {l.label}
          </a>
        ))}
      </nav>
      <p>{t.note}</p>
    </footer>
  );
}
