# Kontraktvarsler skal følge alle erhvervelser

Refs #7249. Sæsonstart-varslet kunne ikke opdage ryttere signeret senere i sæsonen,
mens før-skifte-påmindelsen kun læste seniortruppen. Frigivelsen dækkede allerede ungdom.

Rettelsen genbruger den paginerede kontraktlæser og ét fælles, ikke-fatalt varsel efter
erhvervelse eller trupflyt. Sæsonbeskeder samles pr. hold og type. Testdækning omfatter
ungdom, flere sider, kontraktens effektive udløb og fejl-isolering. Kontraktlængder ændres ikke.

Fremtidige erhvervelsesstier skal kalde samme helper efter den gennemførte skrivning.
Automatisk påmindelse før sæsonskiftet er et separat spor (#7250).
