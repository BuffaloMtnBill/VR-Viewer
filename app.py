"""Start VR-Viewer from a checkout, preferring this project's virtual environment."""
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
venv = root / '.venv'
python = venv / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
if __name__ == '__main__':
    if python.exists() and Path(sys.prefix).resolve() != venv.resolve():
        command = [str(python), str(root/'app.py'), *sys.argv[1:]]
        if os.name == 'nt':
            sys.exit(subprocess.call(command))
        os.execv(command[0], command)
    try:
        from vr_viewer.__main__ import main
    except ModuleNotFoundError as error:
        sys.exit(f"Missing package {error.name}. Run: python -m pip install -r requirements.txt")
    main()
