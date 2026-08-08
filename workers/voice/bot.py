from __future__ import annotations

from app.bot import (
    bot,
    configure_logging,
    install_deepgram_warm_pool_lifespan,
    preload_pipecat_dependencies,
)
from app.config import load_worker_env
from app.daily_room_pool import install_daily_room_pool_lifespan


if __name__ == "__main__":
    load_worker_env()
    configure_logging()
    preload_pipecat_dependencies()
    install_deepgram_warm_pool_lifespan()
    install_daily_room_pool_lifespan()

    from pipecat.runner.run import main

    main()
