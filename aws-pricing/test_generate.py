#!/usr/bin/env python3
"""Offline golden test for the AWS pricing generator — NO network.

Runs generate_aws_pricing.py against the seed/ fixtures (which include decoy SKUs the filters must
reject) and asserts the emitted pricing_us-west-2.json is byte-for-byte the committed golden. This
locks the exact attribute filters: if AWS renames an attribute or a filter regresses, the bytes drift.

Run:  python3 aws-pricing/test_generate.py
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    out = tempfile.mkdtemp(prefix="awsprice_test_")
    subprocess.run(
        [sys.executable, os.path.join(HERE, "generate_aws_pricing.py"),
         "--sample-dir", os.path.join(HERE, "seed"),
         "--now", "2026-07-30T12:00:00Z",
         "--region", "us-west-2", "--out-dir", out],
        check=True,
    )
    with open(os.path.join(out, "pricing_us-west-2.json"), encoding="utf-8") as fh:
        got = fh.read()
    with open(os.path.join(HERE, "seed", "golden_pricing_us-west-2.json"), encoding="utf-8") as fh:
        golden = fh.read()
    if got != golden:
        print("FAIL: pricing_us-west-2.json does not match golden.\n"
              "  Re-inspect the filters, or (if intended) refresh the golden:\n"
              f"    cp {out}/pricing_us-west-2.json {HERE}/seed/golden_pricing_us-west-2.json",
              file=sys.stderr)
        for i, (a, b) in enumerate(zip(got.splitlines(), golden.splitlines()), 1):
            if a != b:
                print(f"  first diff at line {i}:\n    got:    {a}\n    golden: {b}", file=sys.stderr)
                break
        sys.exit(1)
    print("OK: pricing_us-west-2.json matches golden (all filters kept the real SKU, rejected decoys)")


if __name__ == "__main__":
    main()
