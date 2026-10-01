import hashlib
import hmac
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen

from dotenv import load_dotenv
from flask import Flask, jsonify, request, session
from flask_cors import CORS
if __package__:
    from .models import db
    from .auth_routes import register_auth_routes
    from .rag import RagRetriever, build_knowledge_documents, format_retrieved_context
else:
    from models import db
    from auth_routes import register_auth_routes
    from rag import RagRetriever, build_knowledge_documents, format_retrieved_context

if not os.environ.get('PYTEST_CURRENT_TEST'):
    load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

try:
    import razorpay
except ImportError:  # pragma: no cover
    razorpay = None

app = Flask(__name__)
CORS(app)

# Database configuration
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///gene_academy.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize database
db.init_app(app)

# Create tables
with app.app_context():
    db.create_all()

# Session configuration for Google Auth
app.config['SESSION_COOKIE_SECURE'] = False  # Set to True in production with HTTPS
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 86400 * 7  # 7 days
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-this')

# Register auth routes
register_auth_routes(app)

RAZORPAY_KEY_ID = os.environ.get('RAZORPAY_KEY_ID', 'rzp_test_1234567890')
RAZORPAY_KEY_SECRET = os.environ.get('RAZORPAY_KEY_SECRET', 'demo_secret')
GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'
GROQ_MODEL = os.environ.get('GROQ_MODEL', 'openai/gpt-oss-120b')
# Cloudflare in front of the Groq API rejects the default Python-urllib
# User-Agent with "error code: 1010", so send a normal browser agent.
GROQ_USER_AGENT = os.environ.get(
    'GROQ_USER_AGENT',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
)
SUPPORT_SYSTEM_PROMPT = (
    'You are the helpful support assistant for Gene Academy, a digital storefront for video-editing LUTs, courses, and 1:1 sessions. '
    'Answer concisely and warmly. Help with product discovery, purchases, account access, and digital delivery. '
    'All prices are in Indian Rupees (INR). State amounts as ₹ followed by the number, for example ₹18. '
    'Never invent order status, pricing, refund policies, or account details. If information is unavailable, say so and suggest contacting the team. '
    'If a user asks for help or support, provide our contact number: 6289821372 and encourage them to call or message us.'
)
RAG_SYSTEM_INSTRUCTION = (
    'Use the retrieved knowledge below as the primary source for product, delivery, checkout, and support facts. '
    'Do not invent facts that are not present in the retrieved knowledge. '
    'When the retrieved knowledge states a price, quote that exact price and currency from the source instead of saying it is unavailable. '
    'Only say information is unavailable when the retrieved knowledge truly does not contain it. '
    'When a retrieved source answers part of the question, mention its title in brackets. '
    'If the retrieved knowledge is empty or does not contain enough information, say that clearly and suggest contacting the team.'
)

# Sample preset catalog matching the frontend storefront
PRESETS = [
    {
        "id": 1,
        "name": "CHEWY Text Animation",
        "type": "DaVinci Resolve",
        "category": "LUTs",
        "tone": "Warm",
        "price": 18,
        "color": "#e9d3b2",
        "video": "/okki2.mov",
    },
    {
        "id": 2,
        "name": "Coastal Haze",
        "type": "DaVinci Resolve",
        "category": "Courses",
        "tone": "Cool",
        "price": 24,
        "image": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=85",
        "color": "#c8d8d8",
    },
    {
        "id": 3,
        "name": "After Hours",
        "type": "Mobile",
        "category": "1:1 session",
        "tone": "Moody",
        "price": 16,
        "image": "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=900&q=85",
        "color": "#b9aab1",
    },
    {
        "id": 4,
        "name": "Quiet Bloom",
        "type": "DaVinci Resolve",
        "category": "Courses",
        "tone": "Soft",
        "price": 20,
        "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=900&q=85",
        "color": "#e8c3ba",
    },
]

RAG_TOP_K = max(1, min(8, int(os.environ.get('RAG_TOP_K', '4'))))
RAG_MIN_SCORE = float(os.environ.get('RAG_MIN_SCORE', '0.08'))
KNOWLEDGE_DOCUMENTS = build_knowledge_documents(PRESETS)
RAG_RETRIEVER = RagRetriever(KNOWLEDGE_DOCUMENTS, top_k=RAG_TOP_K, min_score=RAG_MIN_SCORE)


def retrieve_knowledge(query, top_k=RAG_TOP_K):
    cleaned_query = str(query or '').strip()
    if not cleaned_query:
        return []
    return RAG_RETRIEVER.search(cleaned_query, top_k=top_k)


def build_rag_system_prompt(results):
    context = format_retrieved_context(results)
    if not context:
        return SUPPORT_SYSTEM_PROMPT
    return f'{SUPPORT_SYSTEM_PROMPT}\n\n{RAG_SYSTEM_INSTRUCTION}\n\nRetrieved knowledge:\n{context}'


def is_real_razorpay_configured():
    key_id = (os.environ.get('RAZORPAY_KEY_ID') or '').strip()
    key_secret = (os.environ.get('RAZORPAY_KEY_SECRET') or '').strip()
    placeholder_values = {
        '',
        'demo_secret',
        'your_secret_here',
        'rzp_test_1234567890',
        'rzp_test_xxxxxxxxxxxxx',
    }
    return bool(key_id) and bool(key_secret) and key_id not in placeholder_values and key_secret not in placeholder_values and key_id.startswith('rzp_')


def verify_razorpay_signature(payment_id, order_id, signature):
    if not all([payment_id, order_id, signature]):
        return False

    # Fail closed: without a real secret the signature cannot be trusted.
    if not is_real_razorpay_configured():
        print('Payment signature rejected because Razorpay credentials are not configured.')
        return False

    payload = f"{order_id}|{payment_id}".encode('utf-8')
    secret = RAZORPAY_KEY_SECRET.encode('utf-8')
    expected = hmac.new(secret, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@app.get('/api/health')
def health():
    return jsonify({"status": "ok", "message": "Flask API is running"})


@app.get('/api/presets')
def get_presets():
    return jsonify(PRESETS)


@app.get('/api/rag')
def rag_status():
    return jsonify({
        "status": "ok",
        "document_count": len(KNOWLEDGE_DOCUMENTS),
        "retriever": "bm25",
        "top_k": RAG_TOP_K,
        "llm": "groq" if os.environ.get('GROQ_API_KEY') else "not_configured",
        "model": GROQ_MODEL,
    })


@app.post('/api/rag/search')
def rag_search():
    data = request.get_json(silent=True) or {}
    query = str(data.get('query', '')).strip()
    if not query:
        return jsonify({"message": "Query is required."}), 400
    if len(query) > 1000:
        return jsonify({"message": "Query must be 1000 characters or fewer."}), 400

    try:
        top_k = int(data.get('top_k', RAG_TOP_K))
    except (TypeError, ValueError):
        return jsonify({"message": "top_k must be a number."}), 400
    top_k = max(1, min(8, top_k))
    results = retrieve_knowledge(query, top_k=top_k)
    return jsonify({
        "query": query,
        "results": results,
        "document_count": len(KNOWLEDGE_DOCUMENTS),
    })


@app.post('/api/support-chat')
def support_chat():
    api_key = (os.environ.get('GROQ_API_KEY') or '').strip()
    if not api_key:
        return jsonify({"message": "AI support is not configured. Add GROQ_API_KEY to the backend environment and restart the server."}), 503

    data = request.get_json(silent=True) or {}
    raw_messages = data.get('messages', [])
    if not isinstance(raw_messages, list):
        return jsonify({"message": "Messages must be a list."}), 400

    messages = []
    for item in raw_messages[-12:]:
        if not isinstance(item, dict):
            continue
        role = item.get('role')
        content = item.get('content')
        if role not in {'user', 'assistant'} or not isinstance(content, str):
            continue
        content = content.strip()
        if content:
            messages.append({"role": role, "content": content[:2000]})

    if not messages or messages[-1]['role'] != 'user':
        return jsonify({"message": "Send a support question to start the chat."}), 400

    query = messages[-1]['content']
    retrieved = retrieve_knowledge(query)
    system_prompt = build_rag_system_prompt(retrieved)
    payload = json.dumps({
        "model": GROQ_MODEL,
        "messages": [{"role": "system", "content": system_prompt}, *messages],
        "max_tokens": 800,
        "temperature": 0.4,
    }).encode('utf-8')
    groq_request = UrlRequest(
        GROQ_CHAT_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": GROQ_USER_AGENT,
        },
        method='POST',
    )

    try:
        with urlopen(groq_request, timeout=30) as response:
            result = json.load(response)
        reply = result.get('choices', [{}])[0].get('message', {}).get('content', '')
        if isinstance(reply, list):
            reply = ''.join(part.get('text', '') for part in reply if isinstance(part, dict))
        if not isinstance(reply, str) or not reply.strip():
            raise ValueError('Groq returned an empty response.')
        sources = [
            {
                "id": item.get("id"),
                "title": item.get("title"),
                "source": item.get("source"),
                "url": item.get("url"),
                "snippet": item.get("snippet"),
            }
            for item in retrieved
        ]
        return jsonify({
            "message": reply.strip(),
            "sources": sources,
            "rag": {
                "enabled": True,
                "retrieved": len(sources),
                "top_k": RAG_TOP_K,
            },
        })
    except HTTPError as error:
        return jsonify({"message": "The Groq support service could not complete this request. Please try again shortly."}), error.code
    except (URLError, TimeoutError, ValueError):
        return jsonify({"message": "The Groq support service is temporarily unavailable. Please try again shortly."}), 502


@app.post('/api/create-order')
def create_order():
    data = request.get_json(silent=True) or {}
    amount = int(data.get('amount', 0))

    if amount <= 0:
        return jsonify({"error": "Amount must be greater than zero."}), 400

    real_payment_enabled = is_real_razorpay_configured()

    if not real_payment_enabled:
        return jsonify({
            "configured": False,
            "message": "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to your .env file and restart the backend.",
            "error": "Missing Razorpay credentials"
        }), 503

    if razorpay is not None:
        try:
            client = razorpay.Client(auth=(os.environ['RAZORPAY_KEY_ID'], os.environ['RAZORPAY_KEY_SECRET']))
            order = client.order.create({
                'amount': amount,
                'currency': 'INR',
                'receipt': 'receipt_order_123',
                'payment_capture': 1,
            })
            return jsonify({
                'key_id': order.get('key_id', os.environ['RAZORPAY_KEY_ID']),
                'amount': order['amount'],
                'currency': order['currency'],
                'order_id': order['id'],
                'message': 'Razorpay order created successfully',
                'configured': True,
            })
        except Exception as exc:
            return jsonify({
                "configured": False,
                "message": f"Razorpay order creation failed: {exc}",
                "error": str(exc)
            }), 500

    return jsonify({
        "configured": False,
        "message": "Razorpay package is missing. Run pip install -r requirements.txt.",
        "error": "Missing Razorpay SDK"
    }), 500


@app.post('/api/verify-payment')
def verify_payment():
    data = request.get_json(silent=True) or {}
    payment_id = data.get('razorpay_payment_id')
    order_id = data.get('razorpay_order_id')
    signature = data.get('razorpay_signature')
    email = data.get('email')
    items = data.get('items', [])

    # Validate required fields
    if not payment_id or not email:
        return jsonify({"success": False, "message": "Payment ID and email are required"}), 400

    # A signature is mandatory. Accepting a payment without one would let anyone
    # claim a successful purchase and receive the download links.
    if not signature or not order_id:
        return jsonify({"success": False, "message": "Payment signature is required"}), 400

    if not verify_razorpay_signature(payment_id, order_id, signature):
        print(f'Signature verification failed for payment_id={payment_id}, order_id={order_id}')
        return jsonify({"success": False, "message": "Invalid payment signature"}), 400

    print(f'Payment verified: payment_id={payment_id}, email={email}, items_count={len(items)}')
    return jsonify({
        "success": True,
        "message": "Payment verified successfully",
        "payment_id": payment_id,
        "order_id": order_id,
        "email": email,
        "items": items,
    })


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
