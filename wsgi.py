# +-------------------------------------------------------------------------+
# | PythonAnywhere WSGI Configuration for ASGames                          |
# | Copy or use this in your PythonAnywhere "WSGI configuration file"      |
# +-------------------------------------------------------------------------+

import sys
import os

# Automatically detect current working directory
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

# Import Flask app as WSGI 'application'
from flask_app import app as application
