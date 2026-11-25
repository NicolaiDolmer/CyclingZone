# #8660 · Samtidige flagkald

Parallelle flaglæseres HTTP-kald blev ikke samlet, selv ved ens autorisation. Den afgrænsede prøve reproducerede dette ved normal samtidig montering. Den første trigger i den oprindelige prod-hændelse er ikke isoleret.
