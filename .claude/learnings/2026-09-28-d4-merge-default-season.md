# S4-cutover: dry-run valgte kommende sæson som rangeringskilde

Ved D4 → D3-sammenlægningen 27/9 valgte `mergeD4IntoD3S4.js` uden `--season` rækken med det højeste sæsonnummer. S4 fandtes allerede som kommende sæson uden afsluttede stillinger, så første dry-run gav nul point til alle hold. Operatøren gentog med S3 eksplicit, før nogen apply blev kørt; prod-fordelingen blev dermed lavet på den korrekte kilde.

Rodårsagen var at dry-run-sorteringen brugte sæsonnummer uden statusfilter. Apply-stien læste allerede kilde-sæsonen fra sit frosne snapshot og var ikke ramt. Rettelsen filtrerer default-opslaget til `completed`, tager den seneste derfra og fejler tydeligt hvis ingen findes. En test stiller S3 completed ved siden af S4 upcoming og kræver S3 som default.

Læring: en fremtidig sæsonrække kan eksistere længe før skiftet. Ethvert cutover-script der vælger en kilde-sæson, skal filtrere på den livscyklus-tilstand det faktisk behøver, og skrive kilde-sæsonen i sit preview/snapshot. Cutover-runbooken anbefaler fortsat et eksplicit `--season` ved den operative kørsel.

Refs #5506 #5857.
