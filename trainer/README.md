# World Mod trainer

product-spec §8: a latent forward-dynamics model over collected episodes, plus
the scaling curve (§8.2) and leave-one-contributor-out utility (§8.3).

```
frame_t ──[frozen encoder]──> z_t ─┐
                                   ├──> [GRU] ──> ẑ_{t+k}
motion_t (from IMU) ───────────────┘
```

## Setup

```sh
python3 -m venv --system-site-packages .venv
.venv/bin/pip install torchvision
```

## Run

```sh
.venv/bin/python run.py --data ../web/.data --out ../web/public/model-results.json
```

It writes into the web app's public directory on purpose: the buyer dashboard
renders `/b/model` straight from that file, so the chart and the run cannot
disagree.

## What is faithful to the spec, and what is not

**Faithful.** The encoder is frozen and only the small head trains — §8.1 is
explicit that we do not have the data to train a backbone and should not pretend
to. The head is ~700k parameters and trains on a laptop in minutes. IMU-derived
motion is the action signal, which is the reason egocentric capture is the right
format: the camera is attached to the actor, so head movement labels the
transition for free.

**Substituted.** §8.1 names DINOv2 or CLIP ViT-B; this uses a torchvision
MobileNetV3 backbone. DINOv2 needs a torch.hub round trip and a far larger
download, and nothing here depends on *which* pretrained features are used —
only that they are pretrained, frozen and meaningful. One line to swap.

**Corrected.** §8.3 describes holding out episodes. This holds out
*contributors*. With a random episode split, some held-out episodes belong to
the very contributor whose training data is being removed, so removing them
inflates error on their own evaluation clips — paying them for correlating with
themselves. Splitting by contributor removes that.

## Reading the numbers honestly

The baseline is **predict no change at all**. Latents from adjacent frames are
so similar that this is a strong baseline, and a model that cannot beat it has
learned only that video is smooth. It is reported next to every result rather
than omitted, because a prediction error with nothing to compare it against
means nothing.

Leave-one-out is a crude Shapley approximation, as §8.3 says. Deltas are noisy
at small N, negative deltas are floored at zero — a negative share would mean a
contributor owing money back — and variance across seeds is reported.
