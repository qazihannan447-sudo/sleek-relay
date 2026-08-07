from __future__ import annotations

from app.bot import bot, configure_logging, preload_pipecat_dependencies
from app.config import load_worker_env


if __name__ == "__main__":
    load_worker_env()
    configure_logging()
    preload_pipecat_dependencies()

    from pipecat.runner.run import main

    main()
