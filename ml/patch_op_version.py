import os
import struct
import flatbuffers
from tensorflow.lite.python import schema_py_generated as schema_fb

def patch_model(filepath):
    print(f"Reading {filepath}...")
    with open(filepath, 'rb') as f:
        buf = bytearray(f.read())

    model = schema_fb.Model.GetRootAsModel(buf, 0)
    patched = False
    for i in range(model.OperatorCodesLength()):
        op_code = model.OperatorCodes(i)
        # BuiltinOperator.FULLY_CONNECTED = 9
        if op_code.BuiltinCode() == 9:
            pos = op_code._tab.Pos
            field_offset = op_code._tab.Offset(8)
            exact_byte_offset = pos + field_offset
            old_version = struct.unpack('<i', buf[exact_byte_offset:exact_byte_offset+4])[0]
            print(f"  Found FULLY_CONNECTED op (index {i}) with version {old_version} at offset {exact_byte_offset}")
            if old_version != 1:
                struct.pack_into('<i', buf, exact_byte_offset, 1)
                print(f"  ✅ Successfully patched FULLY_CONNECTED version {old_version} -> 1")
                patched = True
            else:
                print("  Already version 1.")

    if patched or True:
        with open(filepath, 'wb') as f:
            f.write(buf)
        print(f"Saved patched model to {filepath}")

if __name__ == "__main__":
    ml_path = os.path.join(os.path.dirname(__file__), "theft_detection_model.tflite")
    assets_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "android", "app", "src", "main", "assets", "theft_detection_model.tflite"))
    
    patch_model(ml_path)
    if os.path.exists(assets_path):
        patch_model(assets_path)
    print("Done!")
