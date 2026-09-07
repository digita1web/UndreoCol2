#!/bin/bash
# =============================================================================
# UndreoCol — hook SessionStart
#
# Único propósito hoy: conciliar el hook `Stop` del entorno remoto con la regla
# de git de este repositorio.
#
# EL PROBLEMA. Claude Code en la web instala un hook `Stop`
# (~/.claude/stop-hook-git-check.sh) que, al terminar cada turno, exige publicar
# los commits pendientes. Pero CLAUDE.md §9 dice lo contrario, y sin matices:
#
#     "La IA hace commit. Mateo hace push. Sin excepciones."
#
# reafirmado en §12 como prohibición absoluta. En una rama de trabajo de la IA,
# los commits sin publicar son el estado ESPERADO al terminar el turno, no un
# descuido. Sin este parche, el aviso empuja a la IA a saltarse §9 en cada turno.
#
# QUÉ HACE. Añade al hook `Stop` una guarda que omite ESA comprobación —y solo
# esa— cuando la rama actual empieza por `claude/`. Las demás siguen activas en
# esas ramas, que son las que de verdad protegen el trabajo: cambios sin
# commitear, archivos sin seguir y commits que GitHub marcaría como Unverified.
#
# POR QUÉ AQUÍ Y NO A MANO. ~/.claude/ es local al contenedor y se reprovisiona
# en cada sesión remota: un cambio a mano se pierde al reciclarse. Versionado
# aquí, se aplica solo en cada sesión.
#
# NO FALLA NUNCA. Si el archivo no existe, ya está parcheado, o su contenido
# cambió y el ancla no aparece, informa y sale con 0. Un hook de arranque no
# puede impedir que la sesión arranque.
# =============================================================================

set -uo pipefail

HOOK_STOP="$HOME/.claude/stop-hook-git-check.sh"
MARCA='UNDREOCOL-GUARDA-RAMAS-CLAUDE'
ANCLA='  unpushed=$(git rev-list "$upstream..HEAD" --count 2>/dev/null) || unpushed=0'

# Solo en el entorno remoto: en local, ~/.claude/ es la configuración personal
# de la persona y este repositorio no tiene por qué reescribirla.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  echo "session-start: entorno local, no se toca ~/.claude/ (el parche es solo para sesiones remotas)."
  exit 0
fi

if [ ! -f "$HOOK_STOP" ]; then
  echo "session-start: no existe $HOOK_STOP; nada que parchear."
  exit 0
fi

if grep -q "$MARCA" "$HOOK_STOP"; then
  echo "session-start: el hook Stop ya lleva la guarda de ramas claude/ (idempotente)."
  exit 0
fi

if ! grep -qF "$ANCLA" "$HOOK_STOP"; then
  echo "session-start: AVISO — el hook Stop cambió y no se encontró el ancla esperada."
  echo "session-start: no se aplica el parche. Revisar .claude/hooks/session-start.sh"
  echo "session-start: contra el contenido actual de $HOOK_STOP."
  exit 0
fi

GUARDA=$(cat <<'GUARDA_FIN'
  # UNDREOCOL-GUARDA-RAMAS-CLAUDE (la inserta .claude/hooks/session-start.sh)
  # Ramas de trabajo de la IA: NO se avisa de commits sin publicar, porque
  # CLAUDE.md §9 reserva `git push` a Mateo ("La IA hace commit. Mateo hace
  # push. Sin excepciones."). Aquí los commits pendientes son el estado
  # esperado al cerrar el turno. Alcance estrecho a propósito: solo se salta
  # esta comprobación; cambios sin commitear, archivos sin seguir y firmas no
  # verificables siguen avisando también en estas ramas.
  case "$current_branch" in
    claude/*)
      exit 0
      ;;
  esac

GUARDA_FIN
)

TEMPORAL=$(mktemp) || { echo "session-start: no se pudo crear el archivo temporal."; exit 0; }
GUARDA="$GUARDA" ANCLA="$ANCLA" awk '
  BEGIN { ancla = ENVIRON["ANCLA"]; guarda = ENVIRON["GUARDA"]; hecho = 0 }
  hecho == 0 && $0 == ancla { print guarda; hecho = 1 }
  { print }
  END { exit (hecho ? 0 : 1) }
' "$HOOK_STOP" > "$TEMPORAL"

if [ $? -ne 0 ]; then
  rm -f "$TEMPORAL"
  echo "session-start: AVISO — no se pudo insertar la guarda; el hook Stop queda sin tocar."
  exit 0
fi

if ! bash -n "$TEMPORAL" 2>/dev/null; then
  rm -f "$TEMPORAL"
  echo "session-start: AVISO — el resultado del parche no es bash válido; se descarta."
  exit 0
fi

cat "$TEMPORAL" > "$HOOK_STOP"
rm -f "$TEMPORAL"
echo "session-start: guarda de ramas claude/ aplicada al hook Stop (CLAUDE.md §9)."
exit 0
