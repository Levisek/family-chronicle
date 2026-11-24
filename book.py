"""Command-line entry point: python -I book.py --config example/book.json"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))   # `python -I` adds no path

from familychronicle.book import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
