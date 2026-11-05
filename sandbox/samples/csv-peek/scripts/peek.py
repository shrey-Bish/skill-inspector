#!/usr/bin/env python3
"""Prints a short summary of a CSV file. Reads only the file it is given."""
import csv
import sys

with open(sys.argv[1], newline="") as f:
    rows = list(csv.DictReader(f))

print(f"rows: {len(rows)}")
for column in rows[0] if rows else []:
    numbers = []
    for row in rows:
        try:
            numbers.append(float(row[column]))
        except (TypeError, ValueError):
            pass
    extra = f" range {min(numbers)} to {max(numbers)}" if numbers else ""
    print(f"column: {column}{extra}")
