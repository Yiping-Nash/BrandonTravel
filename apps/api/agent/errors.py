class AgentError(Exception):
    """Safe public error: never attach provider exception text or request URLs."""

    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)

