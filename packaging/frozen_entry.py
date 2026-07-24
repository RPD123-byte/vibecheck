import sys


def main() -> None:
    if len(sys.argv) >= 3 and sys.argv[1] == "--frozen-worker":
        role = sys.argv[2]
        del sys.argv[1:3]
        if role == "inference":
            from vibecheck.inference.process import main as worker_main
        elif role == "notch":
            from vibecheck.notch.process import main as worker_main
        else:
            raise SystemExit(f"unsupported frozen worker role: {role}")
        worker_main()
        return

    from vibecheck.runtime.cli import main as runtime_main

    runtime_main()

if __name__ == "__main__":
    main()
