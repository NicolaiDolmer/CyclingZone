# #8115 · Startliste-sweep og forventet løbslås

Sweepet samlede en bekræftet løbslås og reelle skrivefejl i samme fejltæller. En lås kan opstå efter første læsning og blive bekræftet ved genlæsning efter batchafvisningen.

Registrér den bekræftede lås i sweepets eksisterende skip-tæller. Bevar fejl ved mislykket genlæsning og reelle skrivefejl i alarmgrundlaget. Regressionstesten starter løbet mellem læsning og batch, efterprøver feltet og kontrollerer begge tællere.
