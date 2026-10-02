#!/usr/bin/env python3
"""Build the README's demo assets from headless-Chrome screenshots.

The raw captures are produced with solar-system.html's own URL parameters, e.g.

    chrome --headless=new --screenshot=f00.png --window-size=1000,600 \
      "file:///.../solar-system.html#center=earth&date=2024-06-01&trail=780&pause=1&ui=0"

then assembled here:

    python tools/make-demo-assets.py gif   --frames DIR --out shots/demo-geocentric.gif
    python tools/make-demo-assets.py saturn --edge A.png --open B.png --out shots/saturn-ring-tilt.png
"""
import argparse
import glob
import os
import sys

from PIL import Image


def load(path, size):
    im = Image.open(path).convert('RGB')
    if size:
        im = im.resize(size, Image.LANCZOS)
    return im


def crop_center(im, w, h):
    """Crop a w*h box centred on the image. The camera targets the reference-frame
    centre, so the body of interest is always at the exact canvas centre."""
    if not w or not h or (w >= im.width and h >= im.height):
        return im
    left = (im.width - w) // 2
    top = (im.height - h) // 2
    return im.crop((left, top, left + w, top + h))


def cmd_gif(args):
    files = sorted(glob.glob(os.path.join(args.frames, 'f*.png')))
    if not files:
        sys.exit(f'no frames found in {args.frames}')
    size = (args.width, int(round(args.width * 0.6)))
    frames = [load(f, size).convert('P', palette=Image.ADAPTIVE, colors=args.colors) for f in files]
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    frames[0].save(args.out, save_all=True, append_images=frames[1:],
                   duration=args.duration, loop=0, optimize=True, disposal=1)
    kb = os.path.getsize(args.out) / 1024
    print(f'{len(frames)} frames -> {args.out}  ({size[0]}x{size[1]}, {kb:.0f} KB)')


def cmd_saturn(args):
    a = crop_center(load(args.edge, None), args.crop_w, args.crop_h)
    b = crop_center(load(args.open, None), args.crop_w, args.crop_h)
    if a.height != b.height:
        b = b.resize((int(b.width * a.height / b.height), a.height), Image.LANCZOS)
    gap = 8
    canvas = Image.new('RGB', (a.width + gap + b.width, a.height), (4, 6, 13))
    canvas.paste(a, (0, 0))
    canvas.paste(b, (a.width + gap, 0))
    if args.width and canvas.width > args.width:
        canvas = canvas.resize((args.width, int(canvas.height * args.width / canvas.width)), Image.LANCZOS)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    canvas.save(args.out, optimize=True)
    print(f'{args.out}  ({canvas.width}x{canvas.height}, {os.path.getsize(args.out)/1024:.0f} KB)')


p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = p.add_subparsers(dest='cmd', required=True)

g = sub.add_parser('gif', help='assemble an animated GIF from f*.png frames')
g.add_argument('--frames', required=True)
g.add_argument('--out', required=True)
g.add_argument('--width', type=int, default=900)
g.add_argument('--colors', type=int, default=128, help='GIF palette size; smaller = much smaller file')
g.add_argument('--duration', type=int, default=120, help='ms per frame')
g.set_defaults(func=cmd_gif)

s = sub.add_parser('saturn', help='place two Saturn views side by side')
s.add_argument('--edge', required=True)
s.add_argument('--open', required=True)
s.add_argument('--out', required=True)
s.add_argument('--width', type=int, default=1200)
s.add_argument('--crop-w', type=int, default=0, help='crop each panel to this width, centred')
s.add_argument('--crop-h', type=int, default=0, help='crop each panel to this height, centred')
s.set_defaults(func=cmd_saturn)

a = p.parse_args()
a.func(a)
