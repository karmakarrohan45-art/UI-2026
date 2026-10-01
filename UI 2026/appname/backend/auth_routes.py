import os
from functools import wraps
from datetime import datetime, timedelta

from flask import jsonify, request, session
from google.auth.transport import requests
from google.oauth2 import id_token
import jwt

if __package__:
    from .models import db, User
else:
    from models import db, User

# Google OAuth setup
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
SECRET_KEY = os.environ.get('SECRET_KEY', 'your-secret-key-change-this')

def verify_google_token(token):
    """Verify Google OAuth token and return user info"""
    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            requests.Request(),
            GOOGLE_CLIENT_ID
        )
        
        if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
            raise ValueError('Wrong issuer.')
        
        return idinfo
    except Exception as e:
        print(f"Token verification error: {e}")
        return None

def create_jwt_token(user_id, expires_in=3600):
    """Create JWT token for user"""
    payload = {
        'user_id': user_id,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(seconds=expires_in)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def token_required(f):
    """Decorator to protect routes that require authentication"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Check Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        # Check session cookie
        if not token and 'user_id' in session:
            return f(*args, **kwargs)
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token is invalid'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

def register_auth_routes(app):
    """Register authentication routes to Flask app"""
    
    @app.route('/auth/google', methods=['POST'])
    def google_login():
        """Handle Google OAuth login"""
        try:
            data = request.get_json()
            token = data.get('token')
            
            if not token:
                return jsonify({'message': 'Token is required'}), 400
            
            # Verify token
            user_info = verify_google_token(token)
            
            if not user_info:
                return jsonify({'message': 'Invalid token'}), 401
            
            # Extract user data
            user_id = user_info.get('sub')  # Google's unique ID
            email = user_info.get('email')
            name = user_info.get('name')
            picture = user_info.get('picture')
            
            # Check if user exists in database
            user = User.query.get(user_id)
            
            if not user:
                # Create new user
                user = User(
                    id=user_id,
                    email=email,
                    name=name,
                    picture=picture,
                    role='user'
                )
                db.session.add(user)
            else:
                # Update last login
                user.last_login = datetime.utcnow()
            
            db.session.commit()
            
            # Create session
            session['user_id'] = user_id
            session.permanent = True
            
            # Create JWT token
            access_token = create_jwt_token(user_id)
            
            # Return user data and token
            return jsonify({
                'message': 'Login successful',
                'access_token': access_token,
                'user': user.to_dict()
            }), 200
        
        except Exception as e:
            db.session.rollback()
            print(f"Login error: {e}")
            return jsonify({'message': 'Login failed'}), 500
    
    @app.route('/auth/logout', methods=['POST'])
    def logout():
        """Handle logout"""
        session.clear()
        return jsonify({'message': 'Logged out successfully'}), 200
    
    @app.route('/auth/me', methods=['GET'])
    @token_required
    def get_current_user(current_user_id):
        """Get current user info"""
        user = User.query.get(current_user_id)
        
        if not user:
            return jsonify({'message': 'User not found'}), 404
        
        return jsonify(user.to_dict()), 200
    
    @app.route('/auth/verify', methods=['POST'])
    def verify_token():
        """Verify if a token is valid"""
        token = request.headers.get('Authorization', '').split(' ')[-1]
        
        if not token:
            return jsonify({'valid': False}), 401
        
        try:
            jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            return jsonify({'valid': True}), 200
        except jwt.ExpiredSignatureError:
            return jsonify({'valid': False, 'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'valid': False, 'message': 'Invalid token'}), 401
    
    
    @app.route('/api/debug/users', methods=['GET'])
    def debug_users():
        """Debug endpoint - View all users in database (remove in production!)"""
        users = User.query.all()
        return jsonify({
            'total_users': len(users),
            'users': [user.to_dict() for user in users]
        }), 200
    
    
    @app.route('/api/debug/user/<user_id>', methods=['GET'])
    def debug_user_detail(user_id):
        """Debug endpoint - View specific user details"""
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'message': 'User not found'}), 404
        
        return jsonify({
            'user': user.to_dict(),
            'cart_items': [item.to_dict() for item in user.cart_items],
            'orders': [order.to_dict() for order in user.orders]
        }), 200
