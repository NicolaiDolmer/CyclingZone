# Navnelinket i mobilens I dag-detalje

Refs #6524.

Kortet viste navnet med hover-understregning, men kaldestedet sendte ikke
rytterens id. Derfor renderede RiderLink almindelig tekst, mens det
særskilte profillink virkede.

Telefonvisningen giver nu kortet rytterens id. Testen trykker på navnet
ved 375 og 390 px og sammenligner ruten med det særskilte profillink.
