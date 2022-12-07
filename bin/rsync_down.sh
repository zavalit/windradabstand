#!/bin/bash
cd "$(dirname "$0")"
set -ex

rsync -azxvhtPSe "ssh -o Compression=no" -B 65536 --inplace --exclude='cache/' --exclude='tmp-*' root@168.119.98.135:/root/projects/windradabstand/data/ /Users/michaelkreil/Projekte/privat/ZSHH/windradabstand/data/ --delete-after
rsync -avhtWe "ssh" root@168.119.98.135:/root/projects/windradabstand/docs/tiles /Users/michaelkreil/Projekte/privat/ZSHH/windradabstand/docs/ --delete-after
