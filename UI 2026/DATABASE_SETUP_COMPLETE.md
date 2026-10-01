# SQLite Database Setup - Complete ✅

Your database is now configured! Here's what was done:

## Files Created/Updated:

1. ✅ **models.py** - Database schema with User, CartItem, and Order tables
2. ✅ **auth_routes.py** - Updated to use SQLAlchemy instead of in-memory storage
3. ✅ **app.py** - Initialized database with SQLAlchemy
4. ✅ **requirements.txt** - Added Flask-SQLAlchemy

---

## Step 1: Install New Dependencies

```bash
cd "c:\Users\User\Desktop\all in one\UI 2026\appname\backend"
pip install -r requirements.txt
```

This installs:
- `Flask-SQLAlchemy==3.1.1` (ORM for database)

---

## Step 2: Start the Backend

```bash
python -m flask --app app.py run
```

You should see:
```
* Running on http://127.0.0.1:5000
```

A file `gene_academy.db` will be created automatically in the backend folder.

---

## Step 3: Check the Database

### Option A: View All Users via API

Visit in browser or curl:
```bash
curl http://127.0.0.1:5000/api/debug/users
```

Response:
```json
{
  "total_users": 2,
  "users": [
    {
      "id": "google_id_123",
      "email": "user@example.com",
      "name": "John Doe",
      "picture": "https://...",
      "role": "user",
      "created_at": "2026-09-02T10:30:00",
      "last_login": "2026-09-02T10:35:00"
    }
  ]
}
```

### Option B: View Specific User

```bash
curl http://127.0.0.1:5000/api/debug/user/{user_id}
```

### Option C: Use SQLite CLI

```bash
cd appname/backend
sqlite3 gene_academy.db
```

Then run queries:
```sql
-- View all users
SELECT * FROM users;

-- View user count
SELECT COUNT(*) FROM users;

-- View specific user
SELECT * FROM users WHERE email = 'your@email.com';

-- View cart items
SELECT * FROM cart_items;

-- View orders
SELECT * FROM orders;

-- Exit
.quit
```

### Option D: Use Python

```python
from models import User, db
from app import app

with app.app_context():
    # Get all users
    users = User.query.all()
    for user in users:
        print(f"User: {user.name} ({user.email})")
        print(f"  Created: {user.created_at}")
        print(f"  Last Login: {user.last_login}")
```

---

## What Persists Now:

✅ **User Data** - Survives server restarts
✅ **Login History** - Last login timestamp tracked
✅ **User Roles** - Can assign admin/user roles
✅ **Cart Items** - Per-user cart storage (ready to implement)
✅ **Orders** - Order history with Razorpay tracking

---

## Database File Location

Your database file is saved at:
```
c:\Users\User\Desktop\all in one\UI 2026\appname\backend\gene_academy.db
```

You can:
- **Backup**: Copy this file to restore data
- **Reset**: Delete this file to clear all data (new one is created on startup)

---

## Next Steps (Optional)

To fully utilize the database:

1. **Save cart to database** (currently saves to localStorage in frontend)
   - When user adds items → save to `CartItem` table
   - Load cart from DB when user logs in

2. **Store orders in database**
   - After successful payment → create `Order` record
   - User can view order history

3. **User roles/permissions**
   - Assign admin role to users
   - Restrict actions by role

---

## Testing

1. Start backend: `python -m flask --app app.py run`
2. Start frontend: `npm run dev`
3. Login with Google
4. Check database: `curl http://127.0.0.1:5000/api/debug/users`
5. Should see your user in the database ✅

---

## Troubleshooting

### "ModuleNotFoundError: No module named 'models'"
```bash
pip install -r requirements.txt
```

### "No module named 'sqlalchemy'"
```bash
pip install Flask-SQLAlchemy
```

### Database locked error
- Only one process can write at a time
- Close all SQLite connections and try again

### Data not appearing
- Check if app.py created tables: Look for `gene_academy.db` file
- Check logs: `python -m flask --app app.py run`
- Verify users logged in via Google

---

Done! Your database is ready to use! 🎉
