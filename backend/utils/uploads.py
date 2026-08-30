# utils/uploads.py
#
# Shared upload handling for every endpoint that accepts a CV file.
#
# WHY THIS IS ITS OWN MODULE. The size cap originally lived in main.py and was
# applied to the two /optimize endpoints. That missed
# /api/v1/profile/suggest-name in core/profile_names.py, which takes the same
# kind of upload and read it unbounded — a gap that existed purely because the
# helper was somewhere a second module could not reach without a circular
# import. Putting it here means a new upload endpoint imports the cap rather
# than reinventing (or forgetting) it.
from fastapi import HTTPException, UploadFile, status

# Largest CV upload accepted. A text CV is tens of KB; 5 MB leaves generous
# room for a photo-heavy PDF exported from Word while keeping a single
# request's memory bounded on a 512 MB instance.
MAX_CV_UPLOAD_BYTES = 5 * 1024 * 1024

# Read granularity. Memory in flight is bounded by MAX_CV_UPLOAD_BYTES plus
# one chunk, never by whatever the client decided to send.
_UPLOAD_CHUNK_BYTES = 64 * 1024


def _too_large() -> HTTPException:
    megabytes = MAX_CV_UPLOAD_BYTES // (1024 * 1024)
    return HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail={
            "code": "file_too_large",
            "message": f"That file is larger than {megabytes} MB. Please upload a smaller CV.",
        },
    )


async def read_upload_capped(upload: UploadFile) -> bytes:
    """
    Reads an upload, refusing anything over MAX_CV_UPLOAD_BYTES.

    Streamed rather than `await upload.read()`, deliberately. The one-shot
    read buffers whatever arrives BEFORE any size or format check runs, so a
    large upload is already resident in memory by the time anything can object
    to it. Reading in chunks with a running total means an oversized file is
    abandoned partway instead of being fully received first.

    Content-Length is not trusted as the check — it is a client-supplied
    header. It is only used, when present, to reject early and avoid pulling
    bytes we already know we will not accept.
    """
    declared = upload.size
    if declared is not None and declared > MAX_CV_UPLOAD_BYTES:
        raise _too_large()

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(_UPLOAD_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_CV_UPLOAD_BYTES:
            raise _too_large()
        chunks.append(chunk)
    return b"".join(chunks)
