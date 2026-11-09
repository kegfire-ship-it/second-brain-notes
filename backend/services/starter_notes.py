"""Three helper notes a new install starts with, so there is something to try."""
import logging
import threading
import time
import uuid
from pathlib import Path

from core.auth_user import OWNER_ID
from core.config import settings
from services import notes, vector

_log = logging.getLogger(__name__)

# Listed newest first: the first one ends up on top of the notes page.
_NOTES = [
    ("👋 Welcome: start here", "white", """
<p>These notes are yours and live on your own machine. Here are three things to try. You can delete these starter notes whenever you like.</p>
<p><strong>1. Get the main ideas from a video.</strong> Open the note called "Try it: main ideas from a video".</p>
<p><strong>2. Get step-by-step instructions from a video.</strong> Open the note called "Try it: steps from a video".</p>
<p><strong>3. Search by meaning.</strong> Type the word footwear in the search bar at the top and press Enter. You will also get the note about tying shoes, even though that word isn't written in it.</p>
<p><strong>Your own links.</strong> Create a note and paste a YouTube link, and the same buttons appear. Instagram links work too if you added an Apify token during setup. Ordinary website links get a button that adds a short description, like this one: <a href="https://en.wikipedia.org/wiki/Zettelkasten">https://en.wikipedia.org/wiki/Zettelkasten</a></p>
<p><strong>The menu</strong> in the top right has sorting, the light or dark theme, your categories and the trash.</p>
"""),
    ("Try it: main ideas from a video", "white", """
<p>This note has a link to a video. Press <strong>Main ideas</strong> at the bottom of the note and wait a moment. The ideas will appear right here.</p>
<p><a href="https://www.youtube.com/watch?v=UF8uR6Z6KLc">https://www.youtube.com/watch?v=UF8uR6Z6KLc</a></p>
"""),
    ("Try it: steps from a video", "white", """
<p>This is a short talk on how to tie your shoes so the knot stays tight. Press <strong>Steps</strong> at the bottom of the note to turn it into step-by-step instructions.</p>
<p><a href="https://www.youtube.com/watch?v=zAFcV7zuUDA">https://www.youtube.com/watch?v=zAFcV7zuUDA</a></p>
"""),
]


def _index(created):
    for note_id, title, content in created:
        try:
            vector.upsert_note_vector(note_id, title, content, "Ideas", OWNER_ID)
        except Exception as exc:
            _log.warning("starter note not indexed type=%s", type(exc).__name__)


def seed():
    """Runs once per install: never again after the first start, and never over existing notes."""
    marker = Path(settings.DATA_DIR) / ".starter_notes_done"
    if marker.exists():
        return
    created = []
    if not notes.get_all_notes(user_id=OWNER_ID, include_deleted=True):
        now = int(time.time() * 1000)
        for offset, (title, color, content) in enumerate(_NOTES):
            note_id = str(uuid.uuid4())
            content = content.strip()
            notes.create_or_update_note_file(
                note_id=note_id, title=title, category="Ideas", content=content,
                color=color, order_index=now - offset, user_id=OWNER_ID,
            )
            created.append((note_id, title, content))
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.touch()
    if created:
        threading.Thread(target=_index, args=(created,), daemon=True).start()
