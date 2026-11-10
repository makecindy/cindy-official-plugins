import contextlib
import io
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import main, mock


scripts = Path(__file__).resolve().parents[1] / 'taptap-maker/vendor/taptap-maker/skills/maker-scene-furniture-workflow/scripts'
sys.path.insert(0, str(scripts))
import scene_assets
import test_scene_assets as upstream


class SceneAssetsReviewTest(upstream.SceneAssetsTest):
    def test_frame_budget_boundary(self):
        scene_assets.check_frame_budget((1024, 1024), 32)
        with self.assertRaisesRegex(ValueError, '128 MiB'):
            scene_assets.check_frame_budget((1024, 1024), 33)

    def test_all_baked_motions_reject_large_animations_before_allocating_frames(self):
        image = SimpleNamespace(size=(1800, 1800))
        for motion in ('spring', 'unfurl', 'hang', 'rock', 'slide', 'roll'):
            with self.subTest(motion=motion):
                with mock.patch.object(scene_assets.Image, 'new', side_effect=AssertionError('frame allocated')):
                    with self.assertRaisesRegex(ValueError, '128 MiB'):
                        scene_assets.bake(image, dict(id='large', motion=motion, duration=6, fps=20, pivot=[.5, 1]))

    def test_sequence_budget_is_checked_before_decoding_or_cropping(self):
        scene_assets.Image.new('RGBA', (1024, 1024)).save(self.root/'atlas.png')
        spec = dict(sequence=dict(image='atlas.png', frames=[
            dict(rect=[0, 0, 1024, 1024], durationMs=50) for _ in range(120)]))
        with mock.patch.object(scene_assets.Image.Image, 'convert', side_effect=AssertionError('atlas decoded')):
            with self.assertRaisesRegex(ValueError, '128 MiB'):
                scene_assets.extract(self.root, spec)

    def test_preview_archive_overlap_is_rejected_before_creating_directories(self):
        self.save()
        output = self.root/'output'
        archive = self.root/'output.zip'
        for preview in (archive, archive/'preview', self.root, output, output/'preview'):
            with self.subTest(preview=preview):
                with self.assertRaises((ValueError, FileExistsError)):
                    scene_assets.export(self.root, self.path, output, preview)
                self.assertFalse(output.exists())
                self.assertFalse(archive.exists())

    def test_export_releases_frames_after_writing_preview(self):
        self.save()
        captured = []
        bake = scene_assets.bake

        def capture(*args):
            frames, rect = bake(*args)
            captured.extend(frame for frame, _ in frames)
            return frames, rect

        with mock.patch.object(scene_assets, 'bake', side_effect=capture):
            with contextlib.redirect_stdout(io.StringIO()):
                scene_assets.export(self.root, self.path, self.root/'output', self.root/'preview')
        self.assertTrue(captured)
        for frame in captured:
            with self.assertRaises(ValueError):
                frame.getpixel((0, 0))


if __name__ == '__main__':
    main()
