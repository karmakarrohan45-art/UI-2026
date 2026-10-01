import math
import re
from dataclasses import dataclass


STOP_WORDS = {
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from',
    'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'that', 'the',
    'this', 'to', 'what', 'when', 'where', 'which', 'who', 'with', 'you', 'your',
}


@dataclass(frozen=True)
class KnowledgeDocument:
    id: str
    title: str
    content: str
    source: str
    url: str = ''

    @property
    def text(self):
        return f'{self.title} {self.content}'.strip()


def normalize_text(value):
    return re.sub(r'\s+', ' ', value or '').strip().lower()


def tokenize(value):
    words = re.findall(r'[a-z0-9]+', normalize_text(value))
    return [word for word in words if word not in STOP_WORDS and len(word) > 1]


def build_knowledge_documents(presets):
    documents = [
        KnowledgeDocument(
            id='store-overview',
            title='Gene Academy store',
            source='Storefront knowledge',
            content=(
                'Gene Academy is a digital storefront for video-editing LUTs, courses, and 1:1 sessions. '
                'The catalog includes DaVinci Resolve, Mobile, Course, and Motion Graphics items. '
                'Use the catalog details when helping a customer choose a product.'
            ),
        ),
        KnowledgeDocument(
            id='digital-delivery',
            title='Digital delivery',
            source='Storefront knowledge',
            content=(
                'The products are digital. The checkout form saves an email address for delivery. '
                'After a confirmed payment, download links are sent to the saved email address. '
                'Do not claim a refund policy or an order status that is not available.'
            ),
        ),
        KnowledgeDocument(
            id='support-contact',
            title='Support contact',
            source='Storefront knowledge',
            content='For immediate help with an order, account, or product, call or message 6289821372.',
        ),
        KnowledgeDocument(
            id='account-access',
            title='Account access',
            source='Storefront knowledge',
            content=(
                'The storefront provides Google sign-in and email sign-in fields. '
                'If a customer cannot access an account, ask them to verify the email they used and contact support.'
            ),
        ),
        KnowledgeDocument(
            id='checkout',
            title='Checkout and payment',
            source='Storefront knowledge',
            content=(
                'Checkout uses Razorpay when the backend payment credentials are configured. '
                'If the backend reports that payment is unavailable, tell the customer to try again or contact support.'
            ),
        ),
    ]

    for preset in presets:
        name = str(preset.get('name', 'Untitled product')).strip()
        if not name:
            continue
        product_type = str(preset.get('type', '')).strip()
        category = str(preset.get('category', '')).strip()
        tone = str(preset.get('tone', '')).strip()
        price = preset.get('price')
        details = [f'{name} is listed in the Gene Academy catalog.']
        if product_type:
            details.append(f'It is a {product_type} item.')
        if category:
            details.append(f'It belongs to the {category} category.')
        if tone:
            details.append(f'Its tone is {tone}.')
        if price is not None:
            details.append(f'The catalog price is ₹{price}.')
        documents.append(
            KnowledgeDocument(
                id=f'preset-{preset.get("id", len(documents) + 1)}',
                title=name,
                source='Product catalog',
                content=' '.join(details),
            )
        )

    return documents


class RagRetriever:
    def __init__(self, documents, top_k=4, min_score=0.08):
        self.documents = list(documents)
        self.top_k = max(1, int(top_k))
        self.min_score = float(min_score)
        self.document_tokens = {document.id: tokenize(document.text) for document in self.documents}
        self.document_lengths = {
            document.id: len(tokens) for document, tokens in zip(self.documents, self.document_tokens.values())
        }
        self.document_frequency = {}
        for tokens in self.document_tokens.values():
            for term in set(tokens):
                self.document_frequency[term] = self.document_frequency.get(term, 0) + 1

    def add_documents(self, documents):
        incoming = [document for document in documents if isinstance(document, KnowledgeDocument) and document.id and document.title and document.content]
        if not incoming:
            return False
        existing_ids = {document.id for document in self.documents}
        self.documents.extend(document for document in incoming if document.id not in existing_ids)
        self.document_tokens = {document.id: tokenize(document.text) for document in self.documents}
        self.document_lengths = {document.id: len(tokens) for document, tokens in zip(self.documents, self.document_tokens.values())}
        self.document_frequency = {}
        for tokens in self.document_tokens.values():
            for term in set(tokens):
                self.document_frequency[term] = self.document_frequency.get(term, 0) + 1
        return True

    def search(self, query, top_k=None):
        query_tokens = tokenize(query)
        if not query_tokens:
            return []

        limit = self.top_k if top_k is None else max(1, int(top_k))
        query_counts = {}
        for term in query_tokens:
            query_counts[term] = query_counts.get(term, 0) + 1

        total_documents = len(self.documents)
        average_length = sum(self.document_lengths.values()) / max(1, total_documents)
        scored = []
        for document in self.documents:
            tokens = self.document_tokens[document.id]
            token_counts = {}
            for term in tokens:
                token_counts[term] = token_counts.get(term, 0) + 1

            score = 0.0
            matched_terms = 0
            for term, query_count in query_counts.items():
                frequency = token_counts.get(term)
                if not frequency:
                    continue
                matched_terms += 1
                document_frequency = self.document_frequency.get(term, 0)
                inverse_frequency = math.log(
                    1 + (total_documents - document_frequency + 0.5) / (document_frequency + 0.5)
                )
                length_ratio = self.document_lengths[document.id] / max(1, average_length)
                denominator = frequency + 1.2 * (1 - 0.75 + 0.75 * length_ratio)
                score += inverse_frequency * (frequency * 1.2 + frequency) / denominator * query_count

            title = normalize_text(document.title)
            query = normalize_text(query)
            if query and query in title:
                score += 4
            elif any(term in title.split() for term in query_tokens):
                score += 1.5
            if matched_terms:
                score += min(matched_terms, 4) * 0.08
            if score >= self.min_score:
                scored.append((score, document))

        scored.sort(key=lambda item: (-item[0], item[1].title.lower()))
        return [self._result(document, query, score) for score, document in scored[:limit]]

    def _result(self, document, query, score):
        snippet = self._snippet(document.content, query)
        return {
            'id': document.id,
            'title': document.title,
            'source': document.source,
            'url': document.url,
            'snippet': snippet,
            'score': round(score, 4),
        }

    def _snippet(self, content, query):
        query_words = tokenize(query)
        if not query_words:
            return content[:150].strip()

        # Locate the match in the ORIGINAL text. Slicing with offsets taken from
        # normalize_text() drifts, because normalizing changes the string length,
        # and returning joined tokens would strip punctuation and currency
        # symbols that the assistant relies on to answer correctly.
        lowered = content.lower()
        match_index = None
        for word in query_words:
            found = re.search(r'\b' + re.escape(word) + r'\b', lowered)
            if found and (match_index is None or found.start() < match_index):
                match_index = found.start()

        if match_index is None:
            return content[:150].strip()

        start = max(0, match_index - 80)
        end = min(len(content), match_index + 280)
        window = content[start:end]

        # Never cut mid-sentence: a truncated fact like "The catalog price i..."
        # leaves the assistant unable to answer, so snap to the last full stop.
        if end < len(content):
            boundary = max(window.rfind('. '), window.rfind('.\n'))
            if boundary > 0:
                window = window[:boundary + 1]
                end = start + boundary + 1

        snippet = window.strip()
        prefix = '...' if start > 0 else ''
        suffix = '...' if end < len(content) else ''
        return f'{prefix}{snippet}{suffix}'


def format_retrieved_context(results):
    if not results:
        return ''
    lines = []
    for index, result in enumerate(results, start=1):
        lines.append(
            f'[{index}] {result["title"]} ({result["source"]}): {result["snippet"]}'
        )
    return '\n'.join(lines)
