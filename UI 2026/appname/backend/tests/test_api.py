import os

from backend.app import app


def test_health_endpoint():
    client = app.test_client()
    response = client.get('/api/health')

    assert response.status_code == 200
    assert response.get_json()['status'] == 'ok'


def test_presets_endpoint():
    client = app.test_client()
    response = client.get('/api/presets')

    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert 'name' in data[0]
    assert 'price' in data[0]


def test_create_order_endpoint():
    original_key = os.environ.get('RAZORPAY_KEY_ID')
    original_secret = os.environ.get('RAZORPAY_KEY_SECRET')
    os.environ['RAZORPAY_KEY_ID'] = ''
    os.environ['RAZORPAY_KEY_SECRET'] = ''

    try:
        client = app.test_client()
        response = client.post('/api/create-order', json={'amount': 2500})

        assert response.status_code == 503
        payload = response.get_json()
        assert payload['configured'] is False
        assert 'RAZORPAY_KEY_ID' in payload['message']
    finally:
        if original_key is None:
            os.environ.pop('RAZORPAY_KEY_ID', None)
        else:
            os.environ['RAZORPAY_KEY_ID'] = original_key

        if original_secret is None:
            os.environ.pop('RAZORPAY_KEY_SECRET', None)
        else:
            os.environ['RAZORPAY_KEY_SECRET'] = original_secret


def test_verify_payment_rejects_missing_signature():
    """A payment without a Razorpay signature must never be treated as verified."""
    client = app.test_client()
    response = client.post('/api/verify-payment', json={'razorpay_payment_id': 'pay_123', 'razorpay_order_id': 'order_123', 'email': 'demo@example.com'})

    assert response.status_code == 400
    payload = response.get_json()
    assert payload['success'] is False
    assert 'signature' in payload['message'].lower()


def test_verify_payment_rejects_invalid_signature():
    """A forged signature must be rejected."""
    client = app.test_client()
    response = client.post('/api/verify-payment', json={
        'razorpay_payment_id': 'pay_123',
        'razorpay_order_id': 'order_123',
        'razorpay_signature': 'forged_signature_value',
        'email': 'demo@example.com',
    })

    assert response.status_code == 400
    assert response.get_json()['success'] is False
