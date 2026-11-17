# 🚀 ASGames - PythonAnywhere Cloud Database & Live Site Setup Guide (हिंदी में)

Is guide ki madad se aap **PythonAnywhere (www.pythonanywhere.com)** par apna **permanent database** aur **live website** 5 minute me start kar sakte hain, jisse:
1. **PythonAnywhere Site** par game 24/7 chalega.
2. **Render Site** aur **PythonAnywhere Site** dono ka saara data (Registered Players, User Passwords, Balances, Deposits, Withdrawals) PythonAnywhere me hamesha ke liye permanently save rahega.

---

## Step 1: PythonAnywhere Par Free Account Banayein
1. [www.pythonanywhere.com](https://www.pythonanywhere.com) par jayein.
2. **"Sign up"** par click karein aur **"Create a Beginner account"** (Free) choose karein.
3. Apna Username, Email aur Password daal kar account banayein. (Note: Jo aapka username hoga, wahi aapki website ka address banega, e.g. `https://username.pythonanywhere.com`).

---

## Step 2: GitHub Se Code Clone Karein (1 Command)
1. PythonAnywhere Dashboard me **"Consoles"** tab par click karein.
2. **"Bash"** console kholiye.
3. Bash terminal me niche di gayi command daaliye aur Enter dabayein:
   ```bash
   git clone https://github.com/akshitkumarsaxena3-cyber/asgames.git
   ```
4. Code aapke account me download ho jayega!

---

## Step 3: Web App Create Karein
1. PythonAnywhere Dashboard me **"Web"** tab par jayein.
2. **"Add a new web app"** button par click karein.
3. Domain name par "Next" karein.
4. Framework selection me **"Manual configuration"** choose karein (ya **Flask** -> **Python 3.10** choose karein).
5. Python version me **Python 3.10** select karein aur Next karein.

---

## Step 4: WSGI File & Directory Set Karein
Web tab ke andar:
1. **Source code:**
   Yahan path daaliye:
   `/home/AAPKA_USERNAME/asgames`
   *(AAPKA_USERNAME ki jagah apna real PythonAnywhere username likhein)*

2. **Working directory:**
   Yahan path daaliye:
   `/home/AAPKA_USERNAME/asgames`

3. **WSGI configuration file:**
   - Blue link par click karein jo likha hoga: `/var/www/username_pythonanywhere_com_wsgi.py`
   - Is file ke andar ka saara purana text delete karein aur sirf ye 5 lines paste karke **Save** (Ctrl+S) kar dein:
   ```python
   import sys
   import os

   path = '/home/AAPKA_USERNAME/asgames'
   if path not in sys.path:
       sys.path.insert(0, path)

   from flask_app import app as application
   ```
   *(AAPKA_USERNAME ki jagah apna real username likhein)*.

---

## Step 5: Web App Reload Karein (Live!)
1. Wapas **"Web"** tab par jayein.
2. Green button **"Reload <username>.pythonanywhere.com"** par click karein.
3. Ab aapki website live ho gayi:
   - **Game Website:** `https://AAPKA_USERNAME.pythonanywhere.com/`
   - **Admin Panel:** `https://AAPKA_USERNAME.pythonanywhere.com/admin`
   - **Admin Password:** `spp213201pty`

---

## Step 6: Render Aur PythonAnywhere Ko Connect Karein (Dono Ka Data Save Hoga!)
Ab Render aur PythonAnywhere dono ko aapas me jod dein:
1. Apne **Render Admin Panel** (`https://asgames.onrender.com/admin`) me login karein.
2. Upar naye tab **"☁️ Cloud Database Sync"** par click karein.
3. Input box me apna PythonAnywhere URL daalein:
   `https://AAPKA_USERNAME.pythonanywhere.com`
4. **"💾 Connect & Save"** button dabayein!
5. Status green ho jayega: **"🟢 Connected & Protected"**!

### Ab kya hoga?
- Koi bhi player chahe **Render** par register kare ya **PythonAnywhere** par, uska data, password aur balance turant PythonAnywhere SQLite database me save ho jayega.
- Render server restart ho ya redeploy ho, Render restart hote hi PythonAnywhere se saara data wapas load kar lega!
- Ek bhi rupya ya player ka account kabhi delete nahi hoga!
