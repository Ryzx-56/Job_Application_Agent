import os 
from anthropic import Anthropic 
import google.generativeai as genai 
from dotenv import load_dotenv

load_dotenv()

#Claude Client 
claude_client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
CLAUDE_MODEL = "claude-sonnet-4-20250514"

def call_claude(sysyem_prompt: str, user_message: str, max_tokens: int = 2000) -> str:
  response = claude_client.messages.create(
    model= CLAUDE_MODEL, 
    max_tokens= max_tokens,
    system= sysyem_prompt,
    messages=[{"role": "user","content": user_message}]
  )
  return response.content[0].text

#Gemini Client
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
gemini_flash = genai.GenerativeMODEL("gemini-1.5-flash")

def call_gemini(prompt: str, json_mode: bool = False) -> str:
  config = {"response_mime_type": "application/json"} if json_mode else {}
  response = gemini_flash.generate_content(prompt, generation_config = config)
  return response.text
