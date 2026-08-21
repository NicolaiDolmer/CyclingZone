import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: {
    canonical: "/da",
    languages: { en: "/", da: "/da", "x-default": "/" },
  },
};

// Skelet-copy (#4067 S1) — DA-spejl af EN-forsiden. Endelig copy: tone-session (S2).
export default function DaHomePage() {
  return (
    <main>
      <h1>Den gratis online cycling manager</h1>
      <p>
        Aldrig pay-to-win. Byg dit hold, og kør om kap med hele verden — direkte
        i browseren.
      </p>
      <p>
        <a href="https://cyclingzone.org/login">Spil gratis</a>
      </p>
    </main>
  );
}
