
from datetime import time


def format_elapsed_time(start_time):
	"""計測時間をミリ秒形式で出力"""
	elapsed_ms = (time.perf_counter() - start_time) * 1000
	return f"{elapsed_ms:.2f}ms"
