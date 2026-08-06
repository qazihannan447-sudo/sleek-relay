from __future__ import annotations

from app.bot import bot, configure_logging
from app.config import load_worker_env


if __name__ == "__main__":
    load_worker_env()
    configure_logging()

    from pipecat.runner.run import main

    main()
