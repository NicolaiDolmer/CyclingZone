// #6590 · Offentlig testvektor fra RFC 8291 bilag A (Message Encryption for
// Web Push). Ingen hemmeligheder: vaerdierne staar ordret i RFC'en, saa enhver
// implementering kan kontrolleres byte-for-byte. Ligger i sin egen fil, saa
// secret-scannere (der ser hoej entropi) kun skal undtage denne ene fil.
export const RFC8291_VECTOR = Object.freeze({
  plaintext: "When I grow up, I want to be a watermelon",
  asPriv: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", // gitleaks:allow
  uaPub: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", // gitleaks:allow
  salt: "DGv6ra1nlYgDCS1FRnbzlw", // gitleaks:allow
  uaAuth: "BTBZMqHH6r4Tts7J_aSIgg", // gitleaks:allow
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN", // gitleaks:allow
});
