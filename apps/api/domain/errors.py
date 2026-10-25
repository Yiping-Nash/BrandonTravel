class DomainError(Exception):
    """A safe, client-facing domain failure; never carries infrastructure secrets."""

    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message
        super().__init__(message)
