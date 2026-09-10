# -*- coding: utf-8 -*-
"""ComfyUI-DJ_GroupTitle —— 组标题增强（字号 / 对齐 / 颜色）。

纯前端插件：不注册任何画布节点，只在 ComfyUI 前端挂载组标题交互增强。
因此 NODE_CLASS_MAPPINGS 保持为空字典。
"""

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
