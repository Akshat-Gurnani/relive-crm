package com.relive.calllog

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.CallLog
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PermissionMissing(perm: String) : CodedException("ERR_PERMISSION", "Permission $perm is not granted", null)

// Reads the phone's call log (and finds the dialer's own call recordings) so the CRM can log calls by itself.
class CallLogSyncModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_CONTEXT", "React context is not available", null)

  private fun granted(perm: String) =
    ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED

  override fun definition() = ModuleDefinition {
    Name("CallLogSync")

    Function("isSupported") { true }

    // Calls newer than sinceMs (epoch milliseconds), oldest first.
    AsyncFunction("readCalls") { sinceMs: Double, limit: Int ->
      if (!granted(Manifest.permission.READ_CALL_LOG)) throw PermissionMissing("READ_CALL_LOG")
      val out = ArrayList<Map<String, Any?>>()
      val cols = arrayOf(CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.CACHED_NAME)
      context.contentResolver.query(
        CallLog.Calls.CONTENT_URI, cols, "${CallLog.Calls.DATE} > ?", arrayOf(sinceMs.toLong().toString()), "${CallLog.Calls.DATE} ASC"
      )?.use { c ->
        val iId = c.getColumnIndexOrThrow(CallLog.Calls._ID)
        val iNum = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
        val iType = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
        val iDate = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
        val iDur = c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
        val iName = c.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME)
        while (c.moveToNext() && out.size < limit) {
          val type = when (c.getInt(iType)) {
            CallLog.Calls.INCOMING_TYPE -> "incoming"
            CallLog.Calls.OUTGOING_TYPE -> "outgoing"
            CallLog.Calls.MISSED_TYPE -> "missed"
            CallLog.Calls.REJECTED_TYPE -> "rejected"
            CallLog.Calls.BLOCKED_TYPE -> "blocked"
            else -> "other"
          }
          out.add(mapOf(
            "id" to c.getLong(iId).toString(),
            "number" to (c.getString(iNum) ?: ""),
            "type" to type,
            "date" to c.getLong(iDate).toDouble(),
            "duration" to c.getLong(iDur).toInt(),
            "name" to c.getString(iName),
          ))
        }
      }
      return@AsyncFunction out
    }

    // The dialer's recording of a call, if the phone saved one: an audio file created during or just after the call
    // whose name or folder mentions a call. Returns a content:// URI or null.
    AsyncFunction("findRecording") { startedMs: Double, durationSec: Int, number: String ->
      val perm = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE
      if (!granted(perm)) return@AsyncFunction null
      val from = (startedMs.toLong() / 1000) - 30
      val to = (startedMs.toLong() / 1000) + durationSec + 600
      val digits = number.filter { it.isDigit() }.takeLast(10)
      val collection = if (Build.VERSION.SDK_INT >= 29) MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
      val cols = arrayOf(MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DISPLAY_NAME, MediaStore.Audio.Media.DATE_ADDED, MediaStore.Audio.Media.SIZE)
      var best: String? = null
      context.contentResolver.query(
        collection, cols, "${MediaStore.Audio.Media.DATE_ADDED} BETWEEN ? AND ?", arrayOf(from.toString(), to.toString()), "${MediaStore.Audio.Media.DATE_ADDED} ASC"
      )?.use { c ->
        val iId = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
        val iName = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
        while (c.moveToNext()) {
          val name = (c.getString(iName) ?: "").lowercase()
          val looksLikeCall = name.contains("call") || name.contains("rec") || (digits.isNotEmpty() && name.filter { it.isDigit() }.contains(digits))
          if (looksLikeCall) {
            best = ContentUris.withAppendedId(collection, c.getLong(iId)).toString()
            if (digits.isNotEmpty() && name.filter { it.isDigit() }.contains(digits)) break
          }
        }
      }
      return@AsyncFunction best
    }

    // Reads a recording as base64 for upload. Files above maxBytes are skipped (returns null).
    AsyncFunction("readAsBase64") { uri: String, maxBytes: Int ->
      context.contentResolver.openInputStream(Uri.parse(uri))?.use { s ->
        val bytes = s.readBytes()
        if (bytes.size > maxBytes) null else Base64.encodeToString(bytes, Base64.NO_WRAP)
      }
    }
  }
}
